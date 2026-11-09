// An example recipe: replace it with real sections. Run from the project root:
//   node <skill>/tools/shoot.mjs .showcase/recipes/example.cjs [--only home] [--out dir]
//
// ctx (c): base (baseUrl), ids / session (what the kit planted), mocks (kit's mock folder),
// raw (kit's raw-shots folder), out (--out or .showcase/out/<today>), today, and the
// finders (c.clickText, c.typeInto, c.text, ... see reference/recipes.md).
module.exports = (c) => {
    const desktop = ["size", "1440", "900"];
    const phone = ["size", "390", "844"];
    return {
        // Always runs: sign in, mock what the local machine cannot serve.
        setup: [
            // A minted session:     ["cookie", ...c.session.admin],
            // Or the login form:    ["go", "/login"], ["eval", c.typeInto("input[type=email]", "demo@example.test")],
            //                       ["eval", c.typeInto("input[type=password]", "demo-password")], ["eval", c.submit("input[type=password]")],
            //                       ["sleep", 2000],
            // A mocked API:         ["mock", "/api/external-thing", `${c.mocks}/external-thing.json`],
        ],
        sections: {
            home: [
                desktop,
                ["go", "/", 3000],
                ["shot", `${c.out}/01-desktop-home.png`],
                phone,
                ["go", "/", 3000],
                ["shot", `${c.out}/02-phone-home.png`],
            ],
        },
    };
};
