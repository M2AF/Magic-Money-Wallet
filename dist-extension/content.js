window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const m = event.data;
  if (!m || m.__mm !== "page→bg") return;
  const { id, type, args } = m;
  let retries = 0;
  const attempt = () => {
    chrome.runtime.sendMessage(
      { type, args },
      (res) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message ?? "";
          if ((msg.includes("Receiving end") || msg.includes("Could not establish")) && retries < 2) {
            retries++;
            setTimeout(attempt, 400);
            return;
          }
          window.postMessage({ __mm: "bg→page", id, error: msg }, "*");
          return;
        }
        if (!res) {
          window.postMessage({ __mm: "bg→page", id, error: "No response from wallet" }, "*");
          return;
        }
        window.postMessage({
          __mm: "bg→page",
          id,
          result: res.ok ? res.result : void 0,
          error: res.ok ? void 0 : res.error
        }, "*");
      }
    );
  };
  attempt();
});
chrome.runtime.onMessage.addListener((msg) => {
  if ((msg == null ? void 0 : msg.type) === "eth:event") {
    window.postMessage({ __mm: "bg→page:event", chain: "eth", event: msg.event, data: msg.data }, "*");
  }
});
