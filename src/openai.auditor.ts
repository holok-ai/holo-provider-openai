import {injectable} from 'tsyringe';
import {countTokens, extractPromptByRole, extractTextContent, normalizeText, pickDefined} from "@holokai/holo-sdk";
import {BaseAuditor} from "@holokai/holo-sdk/provider";
import {HoloWorkerRequest, WorkerResponseEnvelope} from "@holokai/holo-types/worker";
import {ProviderDoneEvent, ProviderEvent} from "@holokai/holo-types/provider";
import {
    FinishReason,
    ProviderEnvelope,
    ProviderResponseMetrics,
    ProviderResponseStatus
} from "@holokai/holo-types/entities";
import type {HoloFinishReason, HoloUsage} from "@holokai/holo-types/holo";
import {ChatCompletionChunk, ChatCompletionCreateParamsBase} from "openai/resources/chat/completions";
import {ResponseCreateParamsBase} from "openai/resources/responses/responses";
import {OpenAIProtocols} from "./plugin";

@injectable()
export class OpenAIAuditor extends BaseAuditor {
    readonly provider = 'openai';

    override mapFinishReason(nativeResponse: any, protocolName?: string): HoloFinishReason {
        if (!nativeResponse) return 'stop';

        if (protocolName === OpenAIProtocols.RESPONSES || nativeResponse.response) {
            const status = nativeResponse.response?.status;
            if (status === 'failed') return 'error';
            if (status === 'incomplete') return 'length';
            const hasToolCalls = nativeResponse.response?.output?.some((item: any) => item.type === 'function_call');
            return hasToolCalls ? 'tool_calls' : 'stop';
        }

        const finishReason = nativeResponse.choices?.[0]?.finish_reason;
        switch (finishReason) {
            case 'tool_calls':
                return 'tool_calls';
            case 'length':
                return 'length';
            case 'content_filter':
                return 'content_filter';
            default:
                return 'stop';
        }
    }

    override mapUsage(nativeResponse: any, protocolName?: string): HoloUsage {
        if (!nativeResponse) return {};

        if (protocolName === OpenAIProtocols.RESPONSES || nativeResponse.response) {
            const usage = nativeResponse.response?.usage ?? nativeResponse.usage;
            if (!usage) return {};
            return pickDefined({
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                total_tokens: usage.total_tokens,
            });
        }

        const usage = (nativeResponse as ChatCompletionChunk).usage;
        if (!usage) return {};
        return pickDefined({
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
        });
    }

    protected async extractRequestOptions(workerRequest: HoloWorkerRequest): Promise<Record<string, any>> {
        let options: Record<string, any>;

        if (workerRequest.protocol.name === OpenAIProtocols.RESPONSES) {
            const payload = workerRequest.payload as ResponseCreateParamsBase;

            const {
                max_output_tokens,
                metadata,
                prompt_cache_key,
                prompt_cache_retention,
                safety_identifier,
                stream,
                stream_options,
                temperature,
                tool_choice,
                tools,
                top_p
            } = payload;

            options = pickDefined({
                max_output_tokens,
                metadata,
                prompt_cache_key,
                prompt_cache_retention,
                safety_identifier,
                stream,
                stream_options,
                temperature,
                tool_choice,
                tools,
                top_p
            });
        } else {
            const payload = workerRequest.payload as ChatCompletionCreateParamsBase;

            const {
                frequency_penalty,
                logit_bias,
                logprobs,
                max_completion_tokens,
                max_tokens,
                n,
                parallel_tool_calls,
                presence_penalty,
                response_format,
                safety_identifier,
                seed,
                stop,
                stream,
                stream_options,
                temperature,
                tool_choice,
                tools,
                top_logprobs,
                top_p,
                user,
            } = payload;

            options = pickDefined({
                frequency_penalty,
                logit_bias,
                logprobs,
                max_completion_tokens,
                max_tokens,
                n,
                parallel_tool_calls,
                presence_penalty,
                response_format,
                safety_identifier,
                seed,
                stop,
                stream,
                stream_options,
                temperature,
                tool_choice,
                tools,
                top_logprobs,
                top_p,
                user,
            });
        }

        return options;
    }

    protected async mapProviderResponseMetrics(providerEvent: ProviderDoneEvent, protocolName: string): Promise<Partial<ProviderResponseMetrics>> {
        const usage = this.mapUsage(providerEvent.message, protocolName);
        if (!usage.input_tokens && !usage.output_tokens) return {};

        const usageRaw = protocolName === OpenAIProtocols.RESPONSES
            ? (providerEvent.message?.response?.usage ?? providerEvent.message?.usage)
            : (providerEvent.message as ChatCompletionChunk)?.usage;

        return pickDefined({
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
            usage_raw: usageRaw,
        }) as Partial<ProviderResponseMetrics>;
    }

    protected async mapResponseStatus(providerEvent: ProviderEvent, envelope: WorkerResponseEnvelope): Promise<ProviderResponseStatus> {
        if (providerEvent.type === 'done'
        ) {
            const payload = providerEvent.message;
            const choice = payload.choices?.[0];
            if (choice?.finish_reason) {
                if (choice.finish_reason === 'length') {
                    return ProviderResponseStatus.PARTIAL;
                } else if (choice.finish_reason === 'content_filter') {
                    return ProviderResponseStatus.ERROR;
                }
            }
        }
        return super.mapResponseStatus(providerEvent, envelope);
    }

    protected async extractFinishReason(providerEvent: ProviderEvent, _envelope: WorkerResponseEnvelope): Promise<FinishReason | undefined> {
        if (providerEvent.type === 'error') return FinishReason.ERROR;
        if (providerEvent.type !== 'done') return undefined;
        return this.mapFinishReason(providerEvent.message) as FinishReason;
    }

    protected estimateInputTokens(envelope: WorkerResponseEnvelope):
        number | undefined {
        const payload = envelope.payload as ResponseCreateParamsBase | ChatCompletionCreateParamsBase | undefined;
        if (!payload) return undefined;
        try {
            if ('input' in payload && payload.input) {
                return countTokens(typeof payload.input === 'string' ? payload.input : JSON.stringify(payload.input));
            }
            if ('messages' in payload && payload.messages) {
                return countTokens(JSON.stringify(payload.messages));
            }
        } catch { /* fallthrough */
        }
        return undefined;
    }

    protected async createProviderEnvelope(workerRequest: HoloWorkerRequest): Promise<ProviderEnvelope> {
        let last_user_prompt
            :
            string | null = null;
        let system_prompt: string | null = null;
        let access_model: string | undefined;

        if (workerRequest.protocol.name === OpenAIProtocols.RESPONSES) {
            const payload = workerRequest.payload as ResponseCreateParamsBase;
            access_model = payload.model;

            const input = payload.input;

            last_user_prompt =
                typeof input === 'string'
                    ? normalizeText(input)
                    : extractPromptByRole(
                        input as any[] | undefined,
                        'user',
                        'last',
                        (msg) => extractTextContent(msg.content),
                    );

            system_prompt =
                workerRequest.systemPrompt?.system_prompt ??
                (typeof payload.instructions === 'string'
                    ? normalizeText(payload.instructions)
                    : extractPromptByRole(
                        input as any[] | undefined,
                        'system',
                        'first',
                        (msg) => extractTextContent(msg.content),
                    ));
        } else {
            const payload = workerRequest.payload as ChatCompletionCreateParamsBase;
            access_model = payload.model;

            const messages = payload.messages;

            last_user_prompt = extractPromptByRole(
                messages as any[] | undefined,
                'user',
                'last',
                (msg) => extractTextContent(msg.content),
            );

            system_prompt =
                workerRequest.systemPrompt?.system_prompt ??
                extractPromptByRole(
                    messages as any[] | undefined,
                    'system',
                    'first',
                    (msg) => extractTextContent(msg.content),
                );
        }

        return pickDefined({
            last_user_prompt,
            system_prompt,
            access_model,
        }) as ProviderEnvelope;
    }
}
