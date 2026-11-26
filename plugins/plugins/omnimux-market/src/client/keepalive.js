import { marketRuntime } from "./runtime-state.js";

export function getPlazaKeepAlive() {
  return marketRuntime.plazaKeepAlive;
}

export function setPlazaKeepAlive(value) {
  if (typeof value === "boolean") marketRuntime.plazaKeepAlive = value;
}
