/**
 * Identificador Oficial de Versão, Canal e Build — Importador e-Fatura (EVO-06)
 * Sincronizado automaticamente com /version.json no build para deteção em tempo real no browser.
 */
const host = typeof window !== "undefined" ? window.location.hostname : "";

export const APP_CODE = "EVO_06_EFATURA";
export const APP_CHANNEL: "DEV" | "BETA" | "STABLE" = host.startsWith("dev.")
  ? "DEV"
  : host.startsWith("beta.") || host.startsWith("staging.")
    ? "BETA"
    : "STABLE";

export const APP_VERSION = "v4.2.27";
export const APP_BUILD = "Build #60";
export const APP_FULL_VERSION = `${APP_VERSION} · ${APP_BUILD}`;
