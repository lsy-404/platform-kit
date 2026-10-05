import { preview } from "vite";
import type { Plugin, ResolvedConfig } from "vite";
import { auditAppearance } from "./runner.js";
import { formatReport } from "./format.js";
import type { AuditOptions, Report } from "./types.js";

export interface AppearanceCheckOptions extends Omit<AuditOptions, "urls"> {
  paths?: string[];
  onReport?: (report: Report) => void | Promise<void>;
}

export function appearanceCheck(options: AppearanceCheckOptions = {}): Plugin {
  let config: ResolvedConfig;
  return {
    name: "platform-kit-appearance-check",
    apply: "build",
    configResolved(value) { config = value; },
    async closeBundle() {
      if (config.build.ssr || config.build.lib || !config.build.write) {
        config.logger.warn("[appearance-check] Browser audit requires a written application build; this build was not inspected.");
        return;
      }
      let server: Awaited<ReturnType<typeof preview>> | undefined;
      try {
        if (config.base.startsWith("http")) throw new Error("An external asset base cannot be previewed locally");
        server = await preview({ configFile: false, root: config.root, base: config.base, logLevel: "silent", build: { outDir: config.build.outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true, open: false } });
        const address = server.httpServer.address();
        if (!address || typeof address === "string") throw new Error("Preview did not expose a TCP port");
        const origin = "http://127.0.0.1:" + address.port;
        const base = config.base.startsWith("/") ? config.base : "/";
        const urls = (options.paths ?? [""]).map(path => {
          if (/^[a-z]+:/i.test(path) || path.startsWith("//")) throw new Error("Build audit paths must be local routes");
          return origin + base.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
        });
        const report = await auditAppearance({ ...options, urls });
        if (report.findings.length || report.coverage.length) config.logger.warn(formatReport(report));
        if (options.onReport) await options.onReport(report);
      } catch (error) {
        config.logger.warn("[appearance-check] Build audit incomplete: " + String(error));
      } finally {
        if (server) await new Promise<void>(resolve => server!.httpServer.close(error => {
          if (error) config.logger.warn("[appearance-check] Preview cleanup: " + error.message);
          resolve();
        }));
      }
    },
  };
}
