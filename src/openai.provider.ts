import OpenAI from 'openai';
import {BaseProvider} from '@holokai/holo-sdk/provider';
import {pickDefined} from '@holokai/holo-sdk';
import type {DiscoveredModel, IAuditor, IProviderTranslator, IResponseFactory} from '@holokai/holo-types/provider';
import {ProviderContext, RunHandle} from '@holokai/holo-types/provider';
import {ResponseCreateParamsBase, ResponseErrorEvent, ResponseStreamEvent} from 'openai/resources/responses/responses';
import {ChatCompletionCreateParamsBase} from 'openai/resources/chat/completions';
import {OpenAIAuditor} from './openai.auditor';
import {Model, ModelsPage} from 'openai/resources/models';
import {OpenAITranslator} from './openai.translator';
import {OpenAIResponseFactory} from './openai.response.factory';
import {APIError} from "openai/core/error";
import {ChatCompletionCreateParamsStreaming} from "openai/resources/chat/completions/completions";
import {Stream} from "openai/core/streaming";
import {EmbeddingCreateParams} from "openai/resources";
import {OpenAIProtocols} from "./plugin";
import {ProtocolCapability} from '@holokai/holo-types/entities';

/**
 * OpenAI provider for connecting to OpenAI API
 */
export class OpenAIProvider extends BaseProvider<OpenAI, EmbeddingCreateParams | ResponseCreateParamsBase | ChatCompletionCreateParamsBase> {

    async getModels(allowedModels: string[] | true): Promise<{ object: string, data: Model[] }> {
        const response = await this.client.models.list() as ModelsPage;
        if (allowedModels === true) {
            return response;
        }
        const data = response.data.filter(model => allowedModels.includes(model.id));

        return {
            object: response.object,
            data
        };
    }

    async discoverModels(): Promise<DiscoveredModel[]> {
        const response = await this.client.models.list() as ModelsPage;
        return response.data.map(m => ({
            name: m.id,
            accessModel: m.id,
            description: `AI Model: ${m.id}`,
            version: m.id.match(/-(\d+\.\d+(?:\.\d+)?)/)?.[1]
                ?? m.id.match(/-(\d{4})/)?.[1]
                ?? m.id.match(/-(\d+)$/)?.[1]
                ?? '1.0',
            metadata: m as Record<string, any>,
        }));
    }

    async getModelNameFromRequest(payload: EmbeddingCreateParams | ResponseCreateParamsBase | ChatCompletionCreateParamsBase): Promise<string | undefined> {
        return payload.model;
    }

    async runEmbed(payload: EmbeddingCreateParams) {
        return {
            start: async () => this.client.embeddings.create(payload)
        }
    }

    sanitizePayload(payload: any): void {
        const logger = this.mlog(this.sanitizePayload);
        // Transform deprecated max_tokens to max_completion_tokens
        if (payload.max_tokens !== undefined) {
            payload.max_completion_tokens = payload.max_tokens;
            delete payload.max_tokens;
        }

        // Transform deprecated user to safety_identifier
        if (payload.user !== undefined) {
            payload.safety_identifier = payload.user;
            delete payload.user;
        }

        // Handle restricted models that don't support temperature/sampling parameters
        // - o1/o3 series (o1-preview, o1-mini, o1, o3, etc.)
        // - gpt-5 and above (gpt-5, gpt-6, etc.)
        const model = payload.model?.toLowerCase() || '';
        const isO1OrO3Model = model.startsWith('o1') || model.startsWith('o3');
        const isGpt5Plus = /^gpt-([5-9]|\d{2,})/.test(model);
        const isRestrictedModel = isO1OrO3Model || isGpt5Plus;

        if (isRestrictedModel) {
            // Remove unsupported parameters for restricted models
            delete payload.temperature;
            delete payload.top_p;
            delete payload.frequency_penalty;
            delete payload.presence_penalty;

            logger.debug(`Removed unsupported parameters for restricted model: ${payload.model}`);
        }
    }

    protected createAuditor(): IAuditor {
        return new OpenAIAuditor();
    }

    protected createClient(): OpenAI {
        return new OpenAI(this._config);
    }

    protected createTranslator(): IProviderTranslator {
        return OpenAITranslator.instance();
    }

    protected createResponseFactory(): IResponseFactory {
        return OpenAIResponseFactory.instance();
    }

    protected async translatePayload(capability: ProtocolCapability | undefined, payload: any, protocolName?: string): Promise<any> {
        const translated = await super.translatePayload(capability, payload, protocolName);
        if (protocolName === OpenAIProtocols.RESPONSES) {
            const lastUserMsg = translated.messages?.findLast((m: any) => m.role === 'user');
            const maxTokens = translated.max_completion_tokens ?? translated.max_tokens;
            return pickDefined({
                model: translated.model,
                input: lastUserMsg?.content ?? '',
                max_output_tokens: maxTokens != null ? Math.max(maxTokens, 16) : undefined,
                stream: translated.stream,
                temperature: translated.temperature,
                top_p: translated.top_p,
            });
        }
        return translated;
    }

    protected async handleError(error: APIError): Promise<ResponseErrorEvent> {
        if (error.error) {
            // may need to validate what the error is
            return error.error as ResponseErrorEvent;
        }

        return this.responseFactory.createError(error.message, error.code ? error.code : undefined);
    }

    protected async createRequestRunner(
        params: ResponseCreateParamsBase | ChatCompletionCreateParamsBase | EmbeddingCreateParams,
        ctx: ProviderContext
    ): Promise<RunHandle<any>> {
        this.sanitizePayload(params);

        switch (ctx.protocol.name) {
            case OpenAIProtocols.RESPONSES:
                return this.runResponses(params as ResponseCreateParamsBase, ctx);
            case OpenAIProtocols.EMBED:
                return this.runEmbed(params as EmbeddingCreateParams);
            default:
                return this.runChatCompletions(params as ChatCompletionCreateParamsBase, ctx);
        }
    }

    // --- Responses API ---
    private async runResponses(
        req: ResponseCreateParamsBase,
        ctx: ProviderContext
    ): Promise<RunHandle<any>> {
        if (!req.stream) {
            return {
                start: async () => {
                    const response = await this.client.responses.create({...req, stream: false});
                    ctx.emitTextDelta(response.output_text);
                    return response;
                },
            };
        }

        return {
            start: async () => {
                const stream = await this.client.responses.create({
                    ...req,
                    stream: true
                } as ResponseCreateParamsBase) as Stream<ResponseStreamEvent>;

                let finalChunk;

                for await (const event of stream) {
                    if (
                        event.type === 'response.completed' ||
                        event.type === 'response.failed' ||
                        event.type === 'response.incomplete' ||
                        event.type === 'error'
                    ) {
                        finalChunk = event;
                        break;
                    }

                    ctx.emitStreamEvent(event);

                    if (event.type === 'response.output_text.delta') {
                        ctx.emitTextDelta(event.delta);
                    }
                }

                return finalChunk;
            }
        };
    }

    // --- Chat Completions API ---
    private async runChatCompletions(
        req: ChatCompletionCreateParamsBase,
        ctx: ProviderContext
    ) {
        if (!req.stream) {
            return {
                start: async () => {
                    const response = await this.client.chat.completions.create({...req, stream: false});
                    ctx.emitTextDelta(response.choices[0].message.content);
                    return response;
                },
            };
        }

        const streamingReq = req as ChatCompletionCreateParamsStreaming;
        const includesUsage = streamingReq.stream_options?.include_usage === true

        return {
            start: async () => {
                const stream = await this.client.chat.completions.create(streamingReq);

                let finalChunk;
                for await (const chunk of stream) {
                    const choiceDelta = chunk.choices?.[0]?.delta;
                    const toolCalls = choiceDelta?.tool_calls;
                    if (Array.isArray(toolCalls)) {
                        for (const tc of toolCalls) {
                            const idx = tc.index ?? 0;
                            if (tc.id || tc.function?.name) {
                                const delta: { id?: string; name?: string } = {};
                                if (tc.id) delta.id = tc.id;
                                if (tc.function?.name) delta.name = tc.function.name;
                                ctx.emitToolCallDelta(idx, delta);
                            }
                            if (tc.function?.arguments) {
                                ctx.emitToolCallDelta(idx, {arguments_delta: tc.function.arguments});
                            }
                        }
                    }
                    ctx.emitStreamEvent(chunk);
                    const textDelta = choiceDelta?.content;
                    if (typeof textDelta === 'string' && textDelta.length) {
                        ctx.emitTextDelta(textDelta);
                    }
                    if ((includesUsage && !!chunk.usage) ||
                        (!includesUsage && !!chunk.choices?.[0]?.finish_reason)) {
                        finalChunk = chunk;
                        break;
                    }
                }
                return finalChunk;
            }
        };
    }
}
