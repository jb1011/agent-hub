async function main() {
  console.log("Seed skipped: no default data configured.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
