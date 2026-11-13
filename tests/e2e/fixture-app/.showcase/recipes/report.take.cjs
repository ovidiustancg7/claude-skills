// A take of the fixture's report form: off-camera sign-in, then a filmed walk through it.
module.exports = (c) => ({
    setup: [["size", "390", "844"], ["cookie", ...c.session.admin], ["go", "/report", 500], ["wait", c.q("#shelf")]],
    take: [
        ["intro", "Store report, from the phone", "FIXTURE"],
        ["beat", "Measure the shelf", "STEP 1"],
        ["zoom", "on"],
        ["type", c.q("#shelf"), "240"],
        ["hold", "1200"],
        ["zoom", "off"],
        ["beat", "Fridge photo when needed", "STEP 2"],
        ["tap", c.q("#yes"), "fridge yes"],
        ["hold", "500"],
        // 1 s linear slide from -110 %: 867 ms after the release it must sit at about -50 px.
        ["eval", "'panel at ' + Math.round(new DOMMatrix(getComputedStyle(document.getElementById('panel')).transform).m41)"],
        ["hold", "800"],
        ["scroll", c.q("#send")],
        ["tap", c.q("#send"), "send"],
        ["wait", "!document.getElementById('done').hidden"],
        ["outro", "Sent straight to the report", "", "1500"],
    ],
});
