/**
 * Browser half: a Session-header control that downloads this Session's
 * trajectory as Markdown.
 *
 * Rendering lives entirely on the Host (./index.js + ./lib/markdown.js). This
 * half only preflights the route with HEAD and then hands the GET to the
 * browser download manager, so no Markdown text is buffered in JavaScript.
 */
window.__ModuleLoader__.load({
  id: "dsh-session-md-export",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { Button, Menu, Modal, IconDownloadOutlineRegular } = primitives;

    /** Document-relative form of the Host route registered by ./index.js. */
    const ROUTE = "/api/plugins/dsh-session-md-export/export";

    /** The three renderings offered in the menu; each maps to query switches. */
    const VARIANTS = [
      { id: "plain", label: "导出 Markdown", query: {} },
      { id: "reasoning", label: "导出 Markdown（含思考过程）", query: { reasoning: "1" } },
      { id: "full", label: "导出 Markdown（含系统提示与元信息）", query: { system: "1", meta: "1", inbox: "1" } },
    ];

    function urlFor(sessionId, query) {
      return `${ROUTE}?${new URLSearchParams({ sessionId, ...query }).toString()}`;
    }

    /** Hand one same-origin route to the browser download manager. */
    function save(url) {
      const anchor = document.createElement("a");
      anchor.href = url;
      // Let Content-Disposition choose the persisted title, including Unicode.
      anchor.download = "";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error);
    }

    function ExportMarkdownAction({ sessionId }) {
      const [open, setOpen] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);

      async function run(variant) {
        setOpen(false);
        if (sessionId === undefined || sessionId === null) {
          setError("当前没有可导出的 Session。");
          return;
        }
        setBusy(true);
        setError(null);
        const url = urlFor(sessionId, variant.query);
        try {
          const response = await fetch(url, { method: "HEAD" });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status}${detail === "" ? "" : ` ${detail}`}`);
          }
          save(url);
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      }

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Menu, {
          open,
          align: "end",
          dense: true,
          onClose: () => setOpen(false),
          items: VARIANTS.map((variant) => ({
            id: variant.id,
            label: variant.label,
            icon: React.createElement(IconDownloadOutlineRegular, {}),
          })),
          onSelect: (id) => {
            const variant = VARIANTS.find((candidate) => candidate.id === id);
            if (variant !== undefined) run(variant);
          },
          anchor: React.createElement(Button, {
            size: "sm",
            "aria-label": "导出会话轨迹为 Markdown",
            "aria-haspopup": "menu",
            "aria-expanded": open,
            "aria-busy": busy,
            onClick: () => setOpen((value) => !value),
            children: React.createElement(IconDownloadOutlineRegular, {}),
          }),
        }),
        React.createElement(Modal, {
          open: error !== null,
          onClose: () => setError(null),
          title: "Markdown 导出失败",
          description: error ?? "",
          closeLabel: "关闭",
          footer: React.createElement(Button, {
            variant: "primary",
            onClick: () => setError(null),
            children: "关闭",
          }),
        }),
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "session-md-export",
            order: -1,
          },
          ExportMarkdownAction,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
