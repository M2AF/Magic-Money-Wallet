# Closed-test recruitment kit

Working notes for clearing Google Play's "12 testers, 14 days" gate for
Magic Money (`info.chainlens.magicmoney`). Delete once the app is in production.

**Status to date:** closed track `alpha` serving 0.7.2 (versionCode 15).
1 tester opted in. Need 12 continuously for 14 days before the clock finishes.

**The links** (verified against the console, Alpha track → Testers tab):

- Opt-in (web): https://play.google.com/apps/testing/info.chainlens.magicmoney
- Install (Android): https://play.google.com/store/apps/details?id=info.chainlens.magicmoney

Send the **opt-in** link, and tell people to open it **on their phone**. Opening
it on a desktop splits the flow across two devices and two possible Google
accounts, which is where most silent failures happen.

---

## 1. Message to send each tester

The single biggest cause of a stuck counter is people opening the link on the
wrong Google account. This message front-loads that.

> Hey — I'm trying to get Magic Money onto the Play Store, and Google requires
> 12 people to stay signed up as testers for 14 days before they'll let me
> publish. Would you mind helping? It's about two minutes.
>
> 1. Tell me which Gmail address you want to use, and I'll add it to the list.
> 2. Open this link **while signed into that exact Gmail account**:
>    https://play.google.com/apps/testing/info.chainlens.magicmoney
> 3. Tap **Become a tester**.
> 4. Install Magic Money from the Play Store link on that same page.
>
> The one thing I have to ask: **please leave it installed for at least two
> weeks.** If people drop out and the count falls below 12, Google restarts the
> 14-day clock from zero and I'm back to the beginning.
>
> You don't have to use it much — but if you do poke around, tell me anything
> that looks broken or confusing. Thanks, it genuinely unblocks me.

**Step 1 matters.** Do not guess which address someone uses. People have three
Gmail accounts and their phone is signed into the one you didn't list.

---

## 2. r/androiddev — closed testing thread

That subreddit runs recurring testing threads; post in the current one rather
than as a standalone submission, which will get removed.

> **[Closed testing] Magic Money — multi-chain crypto wallet (Android) — happy to test yours back**
>
> Multi-chain self-custody wallet: Bitcoin, Ethereum + EVM chains, Solana,
> Cardano, Monero, Midnight. Has a built-in dApp browser with ad/tracker
> blocking, and the wallet acts as a device passkey provider.
>
> No ads, no analytics SDKs, no account required — it's a wallet, so the whole
> point is that nothing phones home. Free.
>
> Need 12 testers for the usual 14-day requirement. I'll opt into yours and
> actually leave it installed for the full two weeks — reply with your link and
> I'll confirm once I'm in.
>
> Opt-in: https://play.google.com/apps/testing/info.chainlens.magicmoney
> Reply or DM me the Gmail you want added.

---

## 3. Discord / Telegram tester-exchange groups

Shorter, and these communities expect reciprocity stated up front.

> Magic Money — multi-chain crypto wallet (BTC/ETH/SOL/ADA/XMR), built-in
> dApp browser with ad blocking. Need 12 for the 14-day closed test.
>
> **Reciprocating** — drop your link and I'll opt in today and stay the full 14
> days. Send me the Gmail you want on the list.
>
> https://play.google.com/apps/testing/info.chainlens.magicmoney

Search terms that find these: "Google Play 12 testers", "closed testing
exchange", "android tester swap".

**Reciprocate honestly.** These groups keep informal reputation, and someone who
takes 12 opt-ins and disappears gets named. You also have to actually leave
their apps installed for two weeks.

---

## 4. Do not pay for testers

The paid "12 testers guaranteed" services are a real policy risk, and a crypto
wallet is the highest-scrutiny category on the store. Google has been
terminating accounts over incentivised and fabricated testers. A termination is
account-wide and effectively unappealable — it would cost far more than the
three weeks you'd save.

---

## 5. Keep notes while the test runs

When you apply for production, Google asks how you recruited testers and what
feedback you got. Those answers are far better written now than reconstructed in
three weeks. Click **Preview questions** on the dashboard and skim them.

Log as you go:

| Date | Tester (Gmail) | Opted in? | Feedback received | Acted on |
|---|---|---|---|---|
| | | | | |

Anything a tester reports and you then fix is exactly the evidence the
application is looking for — a changelog entry tied to tester feedback is worth
more than a paragraph of description.

---

## 6. Numbers

Recruit **15–16**, not 12. Dropping below 12 at any point restarts the 14 days,
and some people will uninstall without telling you.

Current: 6 addresses, one of which is yours → 5 external. **Target ~10 more.**

Check the count on the dashboard's "Apply for access to production" box — the
italic line under the second bullet. **Nothing ever emails you about opt-ins;**
that counter is the only signal that exists.