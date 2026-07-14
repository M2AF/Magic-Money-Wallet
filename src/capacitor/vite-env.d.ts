// Vite `?worker` imports (see monero-browser.ts) — the module's default export
// is a Worker constructor bundled from the referenced file.
declare module '*?worker' {
  const WorkerFactory: { new (): Worker }
  export default WorkerFactory
}
