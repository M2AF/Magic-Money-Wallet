// Vite `?worker` imports (used by ../capacitor/monero-browser.ts, which the
// offscreen document pulls into this program) — the module's default export is
// a Worker constructor bundled from the referenced file.
declare module '*?worker' {
  const WorkerFactory: { new (): Worker }
  export default WorkerFactory
}
