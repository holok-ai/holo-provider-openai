import type {FixtureScenario} from '@holokai/holo-test';
import {ProviderResponseStatus} from '@holokai/holo-types/entities';

const completionResponse = {
    id: 'chatcmpl-tool-123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [
        {
            index: 0,
            message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_abc123',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"expression":"2 + 2"}',
                        },
                    }
                ],
            },
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
    name: 'openai/chat-toolcall.nonstreaming',
    plugin: 'openai',
    protocol: 'openai.chatCompletions',
    streaming: false,

    providerChunks: [completionResponse],
    expectedText: '',

    expectedWire: [
        JSON.stringify(completionResponse),
    ],
    expectedStatus: 200,
    expectedHeaders: {'Content-Type': 'application/json'},

    expectedAudit: {
        access_model: 'gpt-4o',
        input_tokens: 50,
        output_tokens: 20,
        status: ProviderResponseStatus.SUCCESS,
    },

    tags: ['chat', 'nonstreaming', 'tool_call'],
};

export default fixture;
