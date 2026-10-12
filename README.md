Control your home network and keep track of connected devices.

Monitor your realtime internet speed, total transmitted data, connection status and router status.

If your router is supported by the mobile phone app of Asus it is very likely this Homey app works too!
It is possible that some functionality does not work on your specific router. Asus has different behaviour on some models.

Tested and confirmed working on:
RT-AX89X

## Classic guest Wi-Fi

Three app-level **Then** Flow cards control an existing guest network:

- **Enable guest network** — unlimited access.
- **Enable guest network for a duration** — 1–43200 whole minutes (30 days).
- **Disable guest network**.

The selector lists configured classic 2.4/5 GHz guest networks, including
disabled ones, with their SSID, band and guest-slot number. Identical SSIDs on
different bands remain separate selections. Configure the network in ASUS
first; these actions do not create networks or change passwords/isolation.
Guest Network Pro / SDN is not supported.

For example, select **Visitors — 2.4 GHz (Guest 1)** and **240 minutes** for
four-hour access. Re-running timed enable starts a fresh router-managed
countdown; Homey does not have to execute a later disable action. Unlimited
enable removes the access-time limit.

Changes restart wireless/firewall services and may briefly interrupt Wi-Fi.
The action verifies configuration, countdown readback, and restart completion,
with a 60-second verification deadline after applying. Already-matching settings
alone do not confirm a repeated enable. An error during confirmation does not
necessarily mean the change was not applied: check the ASUS page before retrying.

Hardware checks used one **RT-AX88U**, stock **3.0.0.4.388_24385**, and Homey
Pro (Early 2023), **v13.5.1**. The firmware reports 30-second timer steps, so do
not expect second-accurate access duration. Detailed hardware results and
coverage limits are recorded in the companion library's `DEVELOPMENT.md`.
The verification refactor has automated coverage; it has not been retested on hardware.

### Development checks

Run `npm test` for the Flow-card tests. Build and validate the app with the
Homey CLI. Runtime guest support requires the corresponding `node-asuswrt`
guest-network methods; the app dependency must point to a release containing
them before this feature is merged/published.
