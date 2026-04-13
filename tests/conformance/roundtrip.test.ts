import {describe, it} from 'vitest';
import {runRoundTripContract} from '@holokai/holo-test';
import adapter from '../sdk-adapter';
import chatStreaming from '../fixtures/chat-simple.streaming.fixture';
import chatNonStreaming from '../fixtures/chat-simple.nonstreaming.fixture';
import responseStreaming from '../fixtures/response-simple.streaming.fixture';
import responseNonStreaming from '../fixtures/response-simple.nonstreaming.fixture';

const fixtures = [chatStreaming, chatNonStreaming, responseStreaming, responseNonStreaming];

describe('openai roundtrip conformance', () => {
    for (const fixture of fixtures) {
        it(fixture.name, () => runRoundTripContract(fixture, adapter));
    }
});
