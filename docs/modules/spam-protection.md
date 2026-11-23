# Protection anti-spam

The guild-configured message window and mention threshold apply only when `spam.enabled` is true. Mention counting includes unique user mentions, role mentions, and one count for `@everyone`/`@here`; exceeding the configured maximum deletes the triggering message and applies the configured timeout. The per-guild WHITELIST role and Discord `ManageMessages` permission bypass these internal limits; neither changes native Discord permissions. WHITELIST matching uses the current guild’s configured role ID, so another server’s role cannot grant an exemption.

Settings remain sanitized in bot settings and configurable in Discord `/setup` or the existing settings panel: 2–30 messages, a 1–60 second window, 2–20 mentions per message and a 1–1,440 minute timeout. `/setup` checks the bot has native `ManageMessages` and `ModerateMembers` before applying the enabled setting; runtime checks channel permissions before acting. Failed native actions emit a fixed monitoring code.

Validation: `node --test bot/spam-policy.test.js bot/spam-runtime.test.js bot/systems/setup/policy.test.js`. Discord staging behavior remains required. No real server configuration is changed by this module.
