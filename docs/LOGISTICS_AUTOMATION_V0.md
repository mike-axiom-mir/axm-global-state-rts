# AXM Global State RTS — logistics automation v0

Status: DESIGN CONTRACT PENDING IMPLEMENTATION

Goal: preserve the user's macro-first worker command model without turning a huge persistent world into per-worker transport simulation.

The intended player action is policy-level: choose what the civilization should gather or produce and how many Crew/specialists should be dedicated. The system then selects legitimate discovered sources, active production buildings and storage routes. The expensive decision happens when the policy or world state changes, not once per worker every frame.

Planned invariants:

- hidden/unseen sources are never eligible;
- workers remain explicit identities and one worker cannot occupy two jobs;
- irreversible role specializations remain meaningful through role factors;
- production buildings buffer output locally instead of teleporting it directly into the civilization stockpile when logistics is enabled;
- aggregate haul routes move buffered output into active storage with throughput determined by route distance and capacity;
- storage destruction can strand production buffers without deleting produced material;
- route work scales with active production/storage routes, not population;
- humans and machine user seats issue the same semantic policy commands through the same 100-APM authority surface when wired into the browser.

This contract is intentionally small. It does not authorize autonomous expansion, construction, research or source discovery.
