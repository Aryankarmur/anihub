export const LOCALHOST_GROUPING_PROJECT_ID = "anihub-73f72";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export const evaluateLocalhostGroupingAccess = ({
  isDevelopment = false,
  isProduction = false,
  hostname = "",
  projectId = "",
  explicitlyEnabled = false,
  allowedUid = "",
  activeUid = "",
  emulatorRequested = false,
} = {}) => {
  const normalizedAllowedUid = typeof allowedUid === "string" ? allowedUid.trim() : "";
  const normalizedActiveUid = typeof activeUid === "string" ? activeUid.trim() : "";

  return isDevelopment === true
    && isProduction !== true
    && LOOPBACK_HOSTS.has(hostname)
    && projectId === LOCALHOST_GROUPING_PROJECT_ID
    && explicitlyEnabled === true
    && emulatorRequested !== true
    && normalizedAllowedUid.length > 0
    && normalizedAllowedUid === normalizedActiveUid;
};

