# Combined Clock / Weather approval study — 2026-11-03

The owner requested equal-height, picturesque halves inside one shared card, with each picture itself
opening Clock or Weather and no text-link footer. This study replaces the separately framed tile
proposal. Clock/Weather appears before Celestial. Existing personal visibility, Weather server switch
and Celestial Workspace `MOON` gate remain; the owner explicitly declined additional Workspace switches.

The mockup uses one shared navy/gold artwork across the equal halves and live HTML readings on top.
Both whole halves are keyboard/touch accessible navigation targets; local preview screens demonstrate
page navigation rather than an overlay. A phone preview control shows the same two-column composition.
Real existing Celestial vector art and a bundled Guide illustration supply context, with fictional
Northstar data. The owner approved this design and authorized implementation, build, commit/push and release. Production
uses a local optimized derivative with a blank clock dial plus actual time-driven native hands.

Before production integration, retain textual time/condition, units, stale-data and missing-data labels;
never present artwork as an observed measurement. Clock hands must agree with the actual displayed time,
or the static clock illustration must clearly be decorative. Weather art should reinforce the supplied
condition without inventing a severe-weather warning. Do not implement remote images or new providers.
When only one instrument is chosen, review its single-instrument composition; when neither is chosen,
the combined card disappears and Celestial can lead. Profile visibility/defaults remain independent.

Built-in image-generation tool, preview only. Original is retained by the thread. Exact prompt:

> Use case: stylized-concept. Create ONE original wide horizontal 2:1 background illustration for a split Clock and Weather app card in VergissMeinNicht's Space Guide / Celestial visual family. This is art only, NO UI mockup, NO text, NO letters, NO numbers, NO logo, NO watermark, NO border. Composition: exactly two balanced visual subjects occupying the left and right halves, same visual scale and shared deep navy star-lit atmosphere; a quiet gap around the vertical center divides them. Left half: an exquisite old brass astronomical clock / pocket-watch instrument, viewed almost front-on with slight dimensional tilt, finely engraved concentric orbital rings and simple blank dial tick marks, two readable hands, floating over a small dark stone fragment. Right half: a richly rendered luminous warm sun partly behind soft silver-blue sculptural clouds, a few delicate rain droplets, floating over a matching small dark stone fragment; a weather miniature, not a landscape. Painterly yet precise storybook 3D illustration, textured brass and silver-blue materials, restrained warm gold light, deep midnight navy, like a magical observatory instrument and hand-painted game object. Objects centered vertically in the upper 75 percent; leave bottom 25 percent of BOTH halves nearly empty dark navy for real app time and weather readings to be overlaid later. Background uniform near-black navy with very few subtle stars; no huge planet and no frame. Keep both subjects picturesque, elegant and equally weighted. The artwork must remain recognizable at small phone card sizes.

Checks: equal half widths/heights and no overflow at 320/390/736px; each picture opens a separate local
preview screen and Back returns to Today. No VMN API or forecast request. Approval was received; the superseded beta.0 remains unpublished and beta.1 is the approved release
candidate. Home/order implementation and validation are in ledger 27.3.
