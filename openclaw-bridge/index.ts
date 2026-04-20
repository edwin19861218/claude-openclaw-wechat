import { z } from "zod";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

import { bridgePlugin, setBridgeRuntime } from "./src/channel.js";

const BridgeConfigSchema = z.object({
  port: z.number().default(3847),
});

export default {
  id: "openclaw-bridge",
  name: "Bridge",
  description: "Local HTTP bridge channel for external message routing",
  configSchema: buildChannelConfigSchema(BridgeConfigSchema),
  register(api: OpenClawPluginApi) {
    if (api.runtime) {
      setBridgeRuntime(api.runtime);
    }
    api.registerChannel({ plugin: bridgePlugin });
  },
};
