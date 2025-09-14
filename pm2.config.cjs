module.exports = {
    name: "beerbot",
    cwd: "./",
    exec_mode: "fork",
    instances: 1,
    script: "src/app.js",
    interpreter: "bun",
    env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
        NODE_ENV: "production",
    },
    repo: "https://github.com/NullDev/BeerBot.git",
    ref: "origin/master",
};
