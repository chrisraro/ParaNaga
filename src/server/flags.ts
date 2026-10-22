// Feature gates read straight from the environment (same rule as the `flag` in env.ts: only the
// exact string "true" turns a gate on). Read per call so API routes follow the deployed value.
// Static pages evaluate it when they are built, so changing it needs a redeploy.

/** Driver reports (N2): off until a named complaint reviewer exists; riders go to MyNaga instead. */
export const driverReportsEnabled = (): boolean => process.env.DRIVER_REPORTS_ENABLED === "true";
