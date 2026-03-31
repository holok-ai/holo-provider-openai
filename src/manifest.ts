import {PluginManifest, PluginType} from "@holokai/holo-types/plugin";
import {VERSION} from './version';

export const manifest: PluginManifest = {
    name: '@holokai/provider-openai',
    version: VERSION,
    pluginType: PluginType.PROVIDER,
    family: 'openai',
    displayName: 'OpenAI Provider',
    description: 'OpenAI provider plugin for Holo.',
};
