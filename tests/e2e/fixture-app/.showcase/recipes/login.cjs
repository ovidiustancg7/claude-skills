// Signing in through a server-rendered form, as a project without minted sessions does.
module.exports = (c) => ({
    setup: [
        ["size", "1440", "900"],
        // Overwrite any session an earlier recipe left (httpOnly: JS cannot clear it).
        ["cookie", "sid", "signed-out"],
    ],
    sections: {
        form: [
            ["go", "/login", 300],
            ["eval", c.typeInto("input[type=email]", "demo@example.test")],
            ["eval", c.typeInto("input[type=password]", "demo-password")],
            ["eval", c.clickButton("Sign in")],
            ["wait", c.text("Dashboard"), 10000],
            ["eval", "location.pathname"],
        ],
    },
});
