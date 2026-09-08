import { createDefine } from "fresh";
import type { Principal } from "./src/auth/auth.ts";
export interface State {
  principal?: Principal;
}
export const define = createDefine<State>();
