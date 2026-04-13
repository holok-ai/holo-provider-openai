import {describe, it} from 'vitest';
import {runWireContract} from '@holokai/holo-test';
import chatStreaming from '../fixtures/chat-simple.streaming.fixture';
import chatNonStreaming from '../fixtures/chat-simple.nonstreaming.fixture';
import responseStreaming from '../fixtures/response-simple.streaming.fixture';
import responseNonStreaming from '../fixtures/response-simple.nonstreaming.fixture';
import toolcallNonStreaming from '../fixtures/chat-toolcall.nonstreaming.fixture';
import toolcallStreaming from '../fixtures/chat-toolcall.streaming.fixture';

const fixtures = [chatStreaming, chatNonStreaming, responseStreaming, responseNonStreaming, toolcallNonStreaming, toolcallStreaming];

describe('openai wire conformance', () => {
    for (const fixture of fixtures) {
        it(fixture.name, () => runWireContract('openai', fixture));
    }
});
