Trademark and Branding Policy

The project name, logos, icons, artwork, visual identity, and other
branding assets are the property of the project maintainers.

No permission is granted to use these assets in a way that implies
official endorsement, affiliation, sponsorship, or representation of
the project.

Forks and modified versions must not present themselves as the
official project and should use different branding where appropriate.

This policy applies regardless of whether any of these marks are
registered trademarks.

Identity of the operator
------------------------

Beyond branding, the deployed service publishes values that identify a specific
natural person as its operator: the legal name, the Argentine tax ID and the
registration token behind the "Data Fiscal" badge.

These are not in the repository. They come from `ADC_PUBLIC_*` environment
variables and the file holding them is not versioned, so a clone builds with all
of them empty. They are public on the live site, though, and copying them from
there is neither permitted nor harmless: deploying them tells your users, and the
Argentine tax authority, that someone else is the seller behind your site and is
accountable for what it charges.

See section 2 of [LICENSE.md](LICENSE.md) for the full list and for how to set
your own.
