# Security

Flow captures local screen context, so security and privacy issues are high
impact.

## Reporting

Please report security issues privately through the repository security advisory
feature or by contacting the maintainers. Do not open a public issue for
vulnerabilities involving screen capture, local event logs, API keys, or
permission bypasses.

## Sensitive Data

- Event logs are stored locally in Application Support.
- Screenshots are privacy-screened before observation generation.
- API keys should be provided through the local environment and are used from
  the Electron main process.
- Do not commit `.env`, event logs, screenshots, generated builds, or packaged
  release artifacts.
