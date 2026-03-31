import {describe, it} from 'vitest';
import {runPipelineContract} from '@holokai/holo-test';
import chatStreaming from '../fixtures/chat-simple.streaming.fixture.js';
import chatNonStreaming from '../fixtures/chat-simple.nonstreaming.fixture.js';
import responseStreaming from '../fixtures/response-simple.streaming.fixture.js';
import responseNonStreaming from '../fixtures/response-simple.nonstreaming.fixture.js';
import toolcallNonStreaming from '../fixtures/chat-toolcall.nonstreaming.fixture.js';
import toolcallStreaming from '../fixtures/chat-toolcall.streaming.fixture.js';

const fixtures = [chatStreaming, chatNonStreaming, responseStreaming, responseNonStreaming, toolcallNonStreaming, toolcallStreaming];

describe('openai pipeline conformance', () => {
    for (const fixture of fixtures) {
        it(fixture.name, () => runPipelineContract('openai', fixture));
    }
});
