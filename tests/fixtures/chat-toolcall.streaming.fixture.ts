import type {FixtureScenario} from '@holokai/holo-test';
import {ProviderResponseStatus} from '@holokai/holo-types/entities';

const chunk1 = {
    id: 'chatcmpl-tool-123',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [
        {
            index: 0,
            delta: {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        index: 0,
                        id: 'call_abc123',
                        type: 'function',
                        function: {name: 'calculate', arguments: ''},
                    }
                ],
            },
            finish_reason: null,
        }
    ],
};

const chunk2 = {
    id: 'chatcmpl-tool-123',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [
        {
            index: 0,
            delta: {
                tool_calls: [
                    {
                        index: 0,
                        function: {arguments: '{"express'},
                    }
                ],
            },
            finish_reason: null,
        }
    ],
};

const chunk3 = {
    id: 'chatcmpl-tool-123',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [
        {
            index: 0,
            delta: {
                tool_calls: [
                    {
                        index: 0,
                        function: {arguments: 'ion":"2 + 2"}'},
                    }
                ],
            },
            finish_reason: null,
        }
    ],
};

const doneChunk = {
    id: 'chatcmpl-tool-123',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [
        {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
        }
    ],
    usage: {
        prompt_tokens: 50,
        completion_tokens: 20,
        total_tokens: 70,
    },
};

const fixture: FixtureScenario = {
    name: 'openai/chat-toolcall.streaming',
    plugin: 'openai',
    protocol: 'openai.chatCompletions',
    streaming: true,

    providerChunks: [chunk1, chunk2, chunk3, doneChunk],
    expectedText: '',

    expectedWire: [
        `data: ${JSON.stringify(chunk1)}\n\n`,
        `data: ${JSON.stringify(chunk2)}\n\n`,
        `data: ${JSON.stringify(chunk3)}\n\n`,
        `data: ${JSON.stringify(doneChunk)}\n\n`,
        `data: [DONE]\n\n`,
    ],
    expectedStatus: 200,
    expectedHeaders: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    },

    expectedAudit: {
        access_model: 'gpt-4o',
        input_tokens: 50,
        output_tokens: 20,
        status: ProviderResponseStatus.SUCCESS,
    },

    tags: ['chat', 'streaming', 'tool_call'],
};

export default fixture;
