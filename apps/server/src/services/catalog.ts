import type {
  ProfileMetadata,
  Repository,
  ServerDevice,
} from "../../../../packages/core/main.ts";
import {
  id,
  parseProfile,
  parseRepository,
  strict,
  text,
} from "../../../../packages/protocol/main.ts";
import type { Transaction } from "../db/database.ts";
import { issue } from "../auth/auth.ts";
import { ApiError } from "./errors.ts";
export class Catalog {
  async registerDevice(
    tx: Transaction,
    userId: string,
    input: unknown,
  ): Promise<{ device: ServerDevice; token: string }> {
    const v = strict(input, ["id", "name", "platform"]);
    const deviceId = id(v.id);
    if (
      (await tx.query("SELECT id FROM devices WHERE id=$1", [deviceId])).length
    ) {
      throw new ApiError(
        409,
        "Device already registered; rotate its token instead",
      );
    }
    const device: ServerDevice = {
      id: deviceId,
      userId,
      name: text(v.name, "name", 300),
      platform: v.platform === undefined
        ? ""
        : text(v.platform, "platform", 100),
      online: false,
    };
    await tx.query(
      "INSERT INTO devices(id,user_id,name,platform) VALUES($1,$2,$3,$4)",
      [device.id, userId, device.name, device.platform],
    );
    return { device, token: await issue(tx, userId, device.id) };
  }
  async device(tx: Transaction, userId: string, deviceId: string) {
    if (
      !(await tx.query("SELECT id FROM devices WHERE user_id=$1 AND id=$2", [
        userId,
        deviceId,
      ])).length
    ) throw new ApiError(404, "Device not found");
  }
  async profile(
    tx: Transaction,
    userId: string,
    deviceId: string,
    input: unknown,
  ): Promise<ProfileMetadata> {
    const profile = parseProfile(input, deviceId);
    await this.device(tx, userId, deviceId);
    const [old] = await tx.query<{ body: ProfileMetadata }>(
      "SELECT body FROM provider_profiles WHERE device_id=$1 AND id=$2",
      [deviceId, profile.id],
    );
    if (old && old.body.provider !== profile.provider) {
      throw new ApiError(409, "Provider identity is immutable");
    }
    const merged = {
      ...old?.body,
      ...Object.fromEntries(
        Object.entries(profile).filter(([, v]) => v !== undefined),
      ),
    } as ProfileMetadata;
    await tx.query(
      "INSERT INTO provider_profiles(device_id,id,user_id,body) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(device_id,id) DO UPDATE SET body=excluded.body",
      [deviceId, profile.id, userId, merged],
    );
    return merged;
  }
  async repository(
    tx: Transaction,
    userId: string,
    deviceId: string,
    input: unknown,
  ): Promise<Repository> {
    const repository = parseRepository(input, deviceId);
    await this.device(tx, userId, deviceId);
    const [existing] = await tx.query<{ device_id: string }>(
      "SELECT device_id FROM repositories WHERE id=$1",
      [repository.id],
    );
    if (existing && existing.device_id !== deviceId) {
      throw new ApiError(409, "Repository ID belongs to another device");
    }
    if (
      repository.defaultProviderProfileId &&
      !(await tx.query(
        "SELECT id FROM provider_profiles WHERE device_id=$1 AND id=$2",
        [deviceId, repository.defaultProviderProfileId],
      )).length
    ) throw new ApiError(409, "Unknown default profile");
    await tx.query(
      "INSERT INTO repositories(id,device_id,user_id,body) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      [repository.id, deviceId, userId, repository],
    );
    return repository;
  }
}
