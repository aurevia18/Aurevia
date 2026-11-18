# Aurevia Exchange

The application source is in [`Aurevia/aurevia`](./Aurevia/aurevia/). Its pinned dependency list, lockfile, and setup scripts are included in this repository.

## Set up after downloading

For a compatible Dev Container or GitHub Codespace, open this repository in the container. It installs the pinned Node.js runtime and runs `npm run setup` automatically.

For a regular clone or ZIP download, install Node.js 22.19.0 with npm 10.x, then run:

```sh
cd Aurevia/aurevia
npm run setup
cp -n .env.example .env
```

`npm run setup` installs the locked project dependencies, generates Prisma Client, installs Chromium and verifies the local toolchain. Setup does not run database migrations or need production credentials. Configure local environment values in `.env` before starting the application.

A source download contains the lockfile and installers, not machine-specific `node_modules`, browser binaries, Docker, or a database server. Setup downloads and installs the project-local tools; an internet connection is required. Docker is optional for development and required for the isolated end-to-end test database.

See the [application README](./Aurevia/aurevia/README.md) for development, test, database, and deployment instructions.
