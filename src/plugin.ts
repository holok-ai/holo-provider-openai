import {BasePlugin, normalizePricingDataset} from '@holokai/holo-sdk/plugin';
import type {IProviderPlugin, PluginContext, PluginPricingSheet, PluginSchema} from '@holokai/holo-types/plugin';
import type {PricingSheetModel} from '@holokai/holo-types/entities';
import {ProtocolCapability} from "@holokai/holo-types/entities";
import {manifest} from "./manifest";
import type {IProvider, IWireAdapter, ProviderCapabilities, WireAdapterParams} from "@holokai/holo-types/provider";
import {OpenAIProvider} from "./openai.provider";
import {RouteDefinition, RouteHandler} from "@holokai/holo-types/routing";
import {OpenAITranslator} from "./openai.translator";
import {OpenAICompletionsWireAdapter, OpenAIResponsesWireAdapter} from "./openai.wire.adapter";
import {OPENAI_PRICING_DATASET} from "./openai.pricing";

export const OpenAIProtocols = {
    EMBED: 'openai.embeddings',
    CHAT_COMPLETIONS: 'openai.chatCompletions',
    RESPONSES: 'openai.responses',
    MODELS: 'openai.models'
} as const;

export type OpenAIProtocols = typeof OpenAIProtocols[keyof typeof OpenAIProtocols];

export class OpenAIProviderPlugin extends BasePlugin implements IProviderPlugin {
    manifest = manifest;
    translator = OpenAITranslator.instance();
    protocols = OpenAIProtocols;
    defaultProtocol = OpenAIProtocols.RESPONSES;

    async createProvider(id: string, name: string, config: any): Promise<IProvider> {
        return new OpenAIProvider(
            id,
            name,
            this,
            config
        );
    }

    async createWireAdapter(params: WireAdapterParams): Promise<IWireAdapter> {
        const {requestId, isStreaming, protocol} = params;
        return protocol === OpenAIProtocols.RESPONSES
            ? new OpenAIResponsesWireAdapter(requestId, isStreaming)
            : new OpenAICompletionsWireAdapter(requestId, isStreaming);
    }

    getProtocolByCapability(capability: ProtocolCapability): string | undefined {
        const route = this.getRoutes().find(r => r.protocol.capability === capability);
        return route?.protocol.name;
    }

    getSchema(): PluginSchema {
        return {
            connection: {
                type: 'object',
                properties: {
                    apiKey: {type: 'string', title: 'API Key', format: 'password', default: 'blank'},
                    baseURL: {type: 'string', title: 'Base URL', format: 'uri'},
                    organizationId: {type: 'string', title: 'Organization ID'},
                },
                required: ['apiKey'],
                encrypted: ['apiKey'],
            },
            parameters: {
                type: 'object',
                properties: {
                    temperature: {type: 'number', title: 'Temperature', minimum: 0, maximum: 2, default: 1},
                    max_tokens: {type: 'integer', title: 'Max Tokens', minimum: 1},
                    top_p: {type: 'number', title: 'Top P', minimum: 0, maximum: 1},
                    frequency_penalty: {
                        type: 'number',
                        title: 'Frequency Penalty',
                        minimum: -2,
                        maximum: 2,
                        default: 0
                    },
                    presence_penalty: {type: 'number', title: 'Presence Penalty', minimum: -2, maximum: 2, default: 0},
                },
            },
        };
    }

    getTestModels() {
        return {chat: 'gpt-4o-mini', embed: 'text-embedding-3-small'};
    }

    getCapabilities(): ProviderCapabilities {
        return {
            streaming: true,
            tools: true,
            vision: true,
            functionCalling: true,
            maxTokens: 128000
        };
    }

    getRoutes(): RouteDefinition[] {
        return [
            {
                paths: ['/models', '/v1/models'],
                method: 'GET',
                protocol: {
                    name: OpenAIProtocols.MODELS,
                    capability: ProtocolCapability.MODELS,
                },
                handler: RouteHandler.MODELS
            },
            {
                paths: ['/chat/completions', '/v1/chat/completions'],
                method: 'POST',
                protocol: {
                    name: OpenAIProtocols.CHAT_COMPLETIONS,
                    capability: ProtocolCapability.CHAT,
                    streamEventSequence: {
                        ordered: ['message_start', 'content_delta', 'message_stop'],
                        repeatable: ['content_delta'],
                    }
                },
                handler: RouteHandler.REQUEST
            },
            {
                paths: ['/responses', '/v1/responses'],
                method: 'POST',
                protocol: {
                    name: OpenAIProtocols.RESPONSES,
                    capability: ProtocolCapability.CHAT,
                    streamEventSequence: {
                        ordered: ['response.created', 'response.output_item.added', 'response.content_part.added', 'response.output_text.delta', 'response.content_part.done', 'response.output_item.done', 'response.completed'],
                        repeatable: ['response.output_text.delta'],
                    }
                },
                handler: RouteHandler.REQUEST
            },
            {
                paths: ['/embeddings', '/v1/embeddings'],
                method: 'POST',
                protocol: {
                    name: OpenAIProtocols.EMBED,
                    capability: ProtocolCapability.EMBED
                },
                handler: RouteHandler.REQUEST
            }

        ]
    }

    getPricingSheets(): Map<string, PluginPricingSheet> {
        return normalizePricingDataset(OPENAI_PRICING_DATASET);
    }

    getPricingModelIds() {
        return OPENAI_PRICING_DATASET.model_ids;
    }

    getDefaultPricing(): PluginPricingSheet {
        const sheets = this.getPricingSheets();
        const sorted = Array.from(sheets.values()).sort(
            (a, b) => b.effective_from.localeCompare(a.effective_from)
        );
        return sorted[0];
    }

    protected calculateExtraCosts(tokens: Record<string, number>, pricing: PricingSheetModel) {
        const cacheReadRate = pricing.token_costs?.cache_read ?? Number(pricing.cache_read_cost ?? 0);
        const cacheReadCost = (tokens.cache_read ?? 0) * cacheReadRate;
        return {
            total: cacheReadCost,
            detail: {
                cache_read: {tokens: tokens.cache_read ?? 0, cost: cacheReadCost},
            }
        };
    }

    protected onInitialize(_context: PluginContext): Promise<void> {
        return Promise.resolve();
    }

    protected onDestroy(): Promise<void> {
        return Promise.resolve();
    }

}
