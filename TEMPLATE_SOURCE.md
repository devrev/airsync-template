Template: https://github.com/devrev/airsync-template
Commit: 050349c2e3308507cfcb63cf974883565c72a63c

Extraction guide: https://devrev-marketing-developer-git-docs-iss-383917-a-68bdfc-dev-rev.vercel.app/airsync/data-extraction-example

The connector uses the template runtime, manifest structure, metadata/mapping format, fixture runner, and SDK dependency. The extraction loop follows the supplied guide. No other connector documentation was consulted.

Live deployment exposed a missing required secret token-verification configuration. The follow-up fix uses the connector deployment plugin's documented bearer-token manifest pattern and verifies against the source `/projects` endpoint.

Live discovery also requires the connection's external organization ID and name. The manifest uses the plugin's documented static organization pattern for this single-account demo, verified against `/projects`. The requirement was confirmed in the platform's keyring validation source.
