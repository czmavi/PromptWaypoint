import {
  type Execution,
  type ProviderProfile,
  type Repository,
} from "../../../packages/core/main.ts";
import { object, string } from "../../../packages/protocol/main.ts";
import { Agent } from "./agent.ts";
export function localApi(
  agent: Agent,
  token: string,
  origins = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
  ],
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (origin && !origins.includes(origin)) {
      return new Response("Forbidden origin", { status: 403 });
    }
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      return new Response("Forbidden host", { status: 403 });
    }
    if (origin) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      headers.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS",
      );
      return new Response(null, { headers });
    }
    // Browser WebSockets carry the local token in a subprotocol, never a URL.
    const protocols =
      req.headers.get("sec-websocket-protocol")?.split(",").map((s) =>
        s.trim()
      ) ?? [];
    if (
      req.headers.get("authorization") !== `Bearer ${token}` &&
      !protocols.includes(`pmai-auth.${token}`)
    ) return new Response("Unauthorized", { status: 401, headers });
    try {
      if (
        url.pathname === "/events" &&
        req.headers.get("upgrade")?.toLowerCase() === "websocket"
      ) {
        const { socket, response } = Deno.upgradeWebSocket(req, {
          protocol: protocols.includes("pmai-events")
            ? "pmai-events"
            : undefined,
        });
        const listener = (e: unknown) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(e));
          }
        };
        socket.onopen = () => agent.listeners.add(listener);
        socket.onclose = () => agent.listeners.delete(listener);
        socket.onerror = () => agent.listeners.delete(listener);
        return response;
      }
      let data: unknown;
      if (req.method === "GET" && url.pathname === "/state") {
        const repositories = await Promise.all(
          agent.store.all<Repository>("repositories").map(async (r) => {
            try {
              return {
                ...r,
                available: (await Deno.stat(r.localPath)).isDirectory,
              };
            } catch {
              return { ...r, available: false };
            }
          }),
        );
        data = {
          device: agent.store.device,
          repositories,
          profiles: agent.store.all<ProviderProfile>("profiles").map((p) => ({
            ...p,
            capabilities: agent.provider(p).capabilities,
            quota: agent.store.get("metadata", `quota:${p.id}`),
            reconciliation: agent.store.get("reconciliation", p.id),
          })),
          sessions: agent.store.all("sessions"),
          executions: agent.store.all("executions"),
        };
      } else if (
        req.method === "GET" &&
        ["/repositories", "/profiles", "/sessions", "/executions"].includes(
          url.pathname,
        )
      ) {
        data = agent.store.all(
          url.pathname.slice(1) as
            | "repositories"
            | "profiles"
            | "sessions"
            | "executions",
        );
      } else if (req.method === "POST" && url.pathname === "/commands") {
        data = await agent.command(await req.json());
      } else if (req.method === "POST" && url.pathname === "/refresh") {
        await agent.refresh(true);
        data = { ok: true };
      } else if (req.method === "POST" && url.pathname === "/repositories") {
        const v = object(await req.json());
        const path = await Deno.realPath(string(v.localPath, "localPath"));
        if (!(await Deno.stat(path)).isDirectory) {
          throw new Error("Not a directory");
        }
        const profileId = v.defaultProviderProfileId === undefined
          ? undefined
          : string(v.defaultProviderProfileId, "defaultProviderProfileId");
        if (profileId && !agent.store.get("profiles", profileId)) {
          throw new Error("Unknown profile");
        }
        const r: Repository = {
          id: crypto.randomUUID(),
          deviceId: agent.store.device.id,
          name: string(v.name, "name"),
          localPath: path,
          defaultProviderProfileId: profileId,
        };
        agent.store.put("repositories", r.id, r);
        agent.emit("repository", r);
        data = r;
      } else if (req.method === "POST" && url.pathname === "/profiles") {
        const v = object(await req.json());
        if (v.provider !== "codex" && v.provider !== "claude") {
          throw new Error("Unknown provider");
        }
        const directory = await Deno.realPath(
          string(v.configDirectory, "configDirectory"),
        );
        if (!(await Deno.stat(directory)).isDirectory) {
          throw new Error("Not a directory");
        }
        if (v.autoResume !== undefined && typeof v.autoResume !== "boolean") {
          throw new Error("Invalid autoResume");
        }
        const p: ProviderProfile = {
          id: crypto.randomUUID(),
          name: string(v.name, "name"),
          provider: v.provider,
          configDirectory: directory,
          autoResume: v.autoResume === true,
        };
        agent.store.put("profiles", p.id, p);
        agent.emit("profile", {
          id: p.id,
          name: p.name,
          provider: p.provider,
          autoResume: p.autoResume,
          capabilities: agent.provider(p).capabilities,
        });
        data = p;
      } else if (
        req.method === "PATCH" &&
        /^\/(repositories|profiles)\/[^/]+$/.test(url.pathname)
      ) {
        const [, collection, id] = url.pathname.split("/");
        const v = object(await req.json());
        if (collection === "profiles") {
          const p = agent.store.get<ProviderProfile>("profiles", id);
          if (!p) throw new Error("Unknown profile");
          if (v.name !== undefined) p.name = string(v.name, "name");
          if (v.autoResume !== undefined) {
            if (typeof v.autoResume !== "boolean") {
              throw new Error("Invalid autoResume");
            }
            p.autoResume = v.autoResume;
          }
          if (v.configDirectory !== undefined || v.provider !== undefined) {
            throw new Error(
              "Create a new profile to change provider or config directory",
            );
          }
          agent.store.put("profiles", id, p);
          agent.emit("profile", {
            id,
            name: p.name,
            provider: p.provider,
            autoResume: p.autoResume,
          });
          data = p;
        } else {
          const r = agent.store.get<Repository>("repositories", id);
          if (!r) throw new Error("Unknown repository");
          if (v.name !== undefined) r.name = string(v.name, "name");
          if (v.defaultProviderProfileId === null) {
            delete r.defaultProviderProfileId;
          } else if (v.defaultProviderProfileId !== undefined) {
            const profileId = string(
              v.defaultProviderProfileId,
              "defaultProviderProfileId",
            );
            if (!agent.store.get("profiles", profileId)) {
              throw new Error("Unknown profile");
            }
            r.defaultProviderProfileId = profileId;
          }
          agent.store.put("repositories", id, r);
          agent.emit("repository", r);
          data = r;
        }
      } else if (
        req.method === "DELETE" &&
        /^\/(repositories|profiles)\/[^/]+$/.test(url.pathname)
      ) {
        const [, collection, id] = url.pathname.split("/");
        const table = collection as "repositories" | "profiles";
        if (
          agent.store.all<Execution>("executions").some((e) =>
            (table === "profiles" ? e.providerProfileId : e.repositoryId) ===
              id && !["completed", "failed"].includes(e.state)
          )
        ) throw new Error("Resource has unfinished executions");
        if (
          table === "profiles" &&
          agent.store.all<Repository>("repositories").some((r) =>
            r.defaultProviderProfileId === id
          )
        ) throw new Error("Profile is a repository default");
        agent.store.remove(table, id);
        agent.emit("removed", { collection, id });
        data = { ok: true };
      } else return new Response("Not found", { status: 404, headers });
      return Response.json(data, { headers });
    } catch (e) {
      return Response.json({
        error: e instanceof Error ? e.message : "Request failed",
      }, { status: 400, headers });
    }
  };
}
