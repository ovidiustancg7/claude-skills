// The e2e recipe: a minted session (cookie), a mock, a rewrite, SPA navigation, phone size.
module.exports = (c) => ({
    setup: [
        ["mock", "/api/external", `${c.mocks}/external.json`],
        // Never matches a page: `go /orders` below must still load the SPA, not this JSON.
        ["mock", "/orders", `${c.mocks}/external.json`],
        ["rewrite", "/api/stats", "http://127.0.0.1:8765", "https://app.example.com"],
        ["cookie", ...c.session.admin],
    ],
    sections: {
        desktop: [
            ["size", "1440", "900"],
            ["go", "/", 500],
            ["wait", c.text("Orders today: 12")],
            ["eval", "document.getElementById('share').textContent + ' | ' + document.getElementById('external').textContent"],
            ["shot", `${c.out}/01-desktop-dashboard.png`],
            ["nav", "/orders", 800],
            ["wait", c.text("Order #1040")],
            ["shot", `${c.out}/02-desktop-orders-full.png`, "full"],
        ],
        phone: [
            ["size", "390", "844"],
            ["go", "/orders", 500],
            ["wait", c.text("Orders")],
            ["shot", `${c.out}/03-phone-orders.png`],
        ],
    },
});
