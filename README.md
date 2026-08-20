# Rechnungshof

> **Fork notice.** Rechnungshof is a self-hosted fork of
> [SFTtech/abrechnung](https://github.com/SFTtech/abrechnung) (German _Abrechnung_ = _settlement_;
> _Rechnungshof_ = _Court of Audit_). All credit for the original work goes to the Abrechnung
> authors — see [authors.md](authors.md). Released under the same **AGPL-3.0-or-later** license.
>
> **What differs from upstream:** authentication is handled exclusively by an external
> OIDC provider ([Authentik](https://goauthentik.io/)). Abrechnung's built-in email/password
> login, registration and password-reset flows are removed. See [NOTES.md](NOTES.md) for
> operating instructions.

_Abrechnung_ is a versatile and user-centric **payment**, **transaction** and **bookkeeping**
management tool for human groups and events — a feature-complete, free and open source
alternative to Splitwise, Tricount or similar.

### Features

- Create and share groups
- Create expenses and money transfers with uneven shares
- Track expense positions
- Permission management within groups to distinguish between viewers, editors and group owners
- Installable on Mobile as a Progressive Web App - use the "Add to Home Screen" feature of your favourite web browser
- Upload images for expenses
- Use multiple currencies with different converesion rates within one group
- Use math expressions when entering numeric values, e.g. typing `(2 + 4) * 3` in a text field will automatically enter `18`
- Graphical representations of the current group balance as well as individual peoples balances over time
- Automatic settlement plans for the whole group
- Create events to manage complex expenses, e.g. multiple people buying things for a multi-day event with different participants each day
- Add tags to expenses and events to quickly filter the expense and event lists
- Unsaved changes are stored locally to not get lost when your internet connection drops
- Export / import groups via JSON
- Export expenses to CSV
- Archive groups to make them readonly

## Documentation

To help you set up your instance or understand the inner workings:

**[Read the documentation!](https://abrechnung.readthedocs.io)**

## Technical foundation

| Technology              | Component       |
| ----------------------- | --------------- |
| **PostgresSQL**         | Database        |
| **Python + FastAPI**    | Backend logic   |
| **React + Material UI** | Web UI frontend |
| **Homo Sapiens**        | Magic sauce     |

## Contributing

If there is **that feature** you really want to see implemented, you found a **bug** or would like to help in some other way, the project of course benefits from your contributions!

- [Contribution guide](https://abrechnung.readthedocs.io/en/latest/development/contributing.html)
- [Issue tracker](https://github.com/SFTtech/abrechnung/issues)
- [Code contributions](https://github.com/SFTtech/abrechnung/pulls)
- [Development roadmap](https://github.com/SFTtech/abrechnung/projects)

### Translations

Translations are managed using the hosted weblate service [here](https://hosted.weblate.org/engage/abrechnung/).

[![Translation Status](https://hosted.weblate.org/widget/abrechnung/multi-auto.svg)](https://hosted.weblate.org/engage/abrechnung/)

## Contact

To directly reach developers and other users, we have chat rooms.
For questions, suggestions, problem support, please join and just ask!

| Contact       | Where?                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Upstream Issues | [SFTtech/abrechnung](https://github.com/SFTtech/abrechnung/issues)                            |
| Fork Issues   | [dragonmasta37070/rechnungshof](https://github.com/dragonmasta37070/rechnungshof/issues)        |
| Matrix Chat   | [`#sfttech:matrix.org`](https://app.element.io/#/room/#sfttech:matrix.org)                      |
| Support us    | [![money sink](https://liberapay.com/assets/widgets/donate.svg)](https://liberapay.com/SFTtech) |

## License

Released under the **GNU Affero General Public License** version 3 or later, see [the authors](authors.md)
and [LICENSE](LICENSE) for details.
