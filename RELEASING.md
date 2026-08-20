# Releasing

## One-time setup

1. **Publish 0.1.0 by hand.** A trusted publisher can only be configured on a
   package that already exists, so the first one comes from your machine.

   ```bash
   npm whoami                 # check WHICH account — this machine has more than one context
   npm login
   npm publish                # publishConfig.access is already "public"
   ```

   Scoped packages are private by default. Without `"access": "public"` in
   `publishConfig` this fails with a 402 asking you to pay for a private
   package, which reads as a billing problem and is not one.

2. **Add the trusted publisher.** npmjs.com → the package → Settings →
   Trusted Publisher → GitHub Actions:

   | Field | Value |
   | --- | --- |
   | Organization or user | `nurkamol` |
   | Repository | `leads-kit` |
   | Workflow filename | `publish.yml` |
   | Environment | *(leave blank)* |

3. **Then turn tokens off.** Settings → Publishing access →
   *Require two-factor authentication or a trusted publisher*. Until you do
   this, a leaked classic token can still publish and the OIDC setup has
   bought you nothing.

## Every release after that

```bash
npm version patch      # or minor / major — writes package.json and tags
git push --follow-tags
```

The workflow verifies that the tag matches `package.json`, typechecks, builds,
runs the tests, and publishes with provenance. Nothing publishes from a plain
push to `main`.

## Why not GitHub Packages

The Packages panel on your GitHub profile offers `npm.pkg.github.com`. It is a
different registry from npmjs.com, and installing from it needs an auth token
in `.npmrc` **even for public packages** — which defeats the point of a package
you want to drop into any project without ceremony. It is the right choice for
private org-internal packages and the wrong one for this.
