const requiredMajor = 20;
const current = process.versions.node;
const major = Number(current.split(".")[0]);

if (!Number.isFinite(major) || major < requiredMajor) {
  console.error(
    [
      "Unsupported Node.js version.",
      "This backend requires Node.js >= 20.",
      "Current version: " + current,
      "Run `nvm use` from the backend directory, or install/use Node.js 20+ before building.",
    ].join("\n")
  );
  process.exit(1);
}
