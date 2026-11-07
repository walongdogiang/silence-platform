# TASK: Implement Axiom Studio — Premium Dark AI Engineering Desktop UI

## 1. ROLE AND OBJECTIVE

Act as a senior product designer, desktop UI architect, and senior frontend engineer.

Implement the actual UI of **Axiom Studio**, an AI Engineering Studio desktop application for orchestrating AI agents, managing project knowledge, tracking tasks and decisions, reviewing code changes, and verifying engineering outcomes.

The user has approved the supplied visual reference as the target design direction.

Your job is to reproduce the reference as closely as reasonably possible while creating a maintainable, responsive, production-quality interface.

This is an implementation task, not a brainstorming task.

Do not replace the target with a generic SaaS dashboard, a generic AI chat interface, or a completely different visual concept.

## 2. NON-NEGOTIABLE DESIGN DIRECTION

Product identity:
- Product name: Axiom Studio
- Product category: AI Engineering Studio / AI developer desktop application
- Default appearance: premium dark
- Overall personality: sophisticated, cinematic, calm, precise, professional, developer-focused
- Primary visual qualities: layered dark surfaces, subtle depth, warm restrained highlights, elegant typography, clear information hierarchy
- The application should feel like a dedicated engineering workbench rather than an ordinary website.

The supplied reference image is the visual source of truth.

Match its:
- Overall three-column composition
- Sidebar and workspace proportions
- Top application toolbar
- Project header and navigation tabs
- Central conversation and execution plan
- Lower file tree and code diff area
- Right-side project and agent context panels
- Bottom prompt composer
- Warm amber/copper highlights
- Rounded surfaces, restrained borders, spacing and typography
- Appearance customization panel

Do not copy incidental artifacts or incorrect text from the image if they conflict with real product requirements.

## 3. FIRST: INSPECT THE EXISTING REPOSITORY

Before editing files:

1. Inspect the repository structure, package scripts, framework, existing components, routing, styling system, installed dependencies and current application entry point.
2. Read existing project instructions and relevant rules.
3. Identify whether the application already uses React, TypeScript, Tauri, Electron, or another established stack.
4. Reuse the current architecture and conventions wherever possible.
5. Identify existing working features that must not be broken.
6. Produce a short implementation plan, then proceed with implementation.

Do not replace the existing stack merely because you prefer another one.

Do not introduce a second UI framework or an unnecessary component library.

Do not overwrite existing business logic with mock implementations.

If the repo is empty or contains only a scaffold, implement the UI using the stack already configured. If a critical decision cannot be determined from the repository, explain the blocker before making an irreversible architectural change.

## 4. DESKTOP WINDOW AND GLOBAL LAYOUT

Design for a desktop window with a reference viewport of 1536 × 1024 px.

The layout must adapt to other desktop sizes. It must not simply scale down the entire reference image.

Create three main regions:

A. LEFT SIDEBAR
- Target width: approximately 264 px at the reference viewport.
- Full-height vertical layout.
- Slightly lighter or warmer than the main app background.
- Clear distinction between navigation, workspace/project tree and account controls.
- Sidebar can collapse to an icon rail.
- Preserve its expanded/collapsed state in user preferences.

B. CENTRAL WORKSPACE
- Flexible width and primary visual focus.
- Contains the application/project header, project tabs, conversation, execution plan, change review area and prompt composer.
- Must manage its own scrolling so the entire application does not scroll as one giant page.
- Prefer a CSS Grid or similarly robust layout system.
- The prompt composer remains anchored to the bottom of the workspace.
- Avoid fixed absolute positioning for major application layout regions.

C. RIGHT CONTEXT PANEL
- Target width: approximately 310 px at the reference viewport.
- Contains Project Overview, Current Initiative, Tasks, AI Agents and Context.
- Use vertically stacked, compact cards with consistent spacing.
- Allow the panel to collapse or hide to provide more room for coding.
- At narrower window sizes, hide or collapse this panel before compressing the central workspace excessively.

Use a subtle 1 px border between major regions. Use restrained corner radii, consistent padding and clear alignment.

Suggested layout:
- Sidebar: 264 px
- Central workspace: minmax(0, 1fr)
- Right context: 310 px
- Main inter-region gap: approximately 10–14 px
- Standard card radius: 10–14 px
- Control radius: 7–10 px

Treat these as starting values. Refine proportions against the reference image.

## 5. COLOR SYSTEM

Implement the UI with semantic design tokens using CSS variables or the existing theme system.

Suggested default dark palette:

--app-bg: #171614;
--sidebar-bg: #211C19;
--surface-1: #211F1E;
--surface-2: #292522;
--surface-3: #302A25;
--surface-hover: #393029;
--border-subtle: #40352D;
--border-strong: #574538;

--accent: #C78B58;
--accent-hover: #D69A68;
--accent-soft: #E6B587;
--accent-muted: #684832;

--text-primary: #F1EAE2;
--text-secondary: #B8ADA2;
--text-muted: #897E74;

--success: #54B58A;
--warning: #D9A45B;
--error: #D57970;
--info: #79AFC8;

The palette must be cohesive and comfortable for extended use.

Color rules:
- Use charcoal and graphite as the structural foundation.
- Use copper/amber for primary actions, selected navigation and a small number of meaningful highlights.
- Do not make every button orange.
- Avoid large areas of pure black.
- Avoid large areas of saturated neon colors.
- Avoid strong red/green contrasts as decorative elements.
- Use semantic success, warning and error colors primarily for statuses.
- Keep secondary text readable without making it as bright as primary text.
- Keep borders subtle and avoid excessive outlines.
- Use tonal contrast between adjacent surfaces instead of bright contrasting colors everywhere.

Code syntax colors must remain legible and semantically distinct against the editor background.

## 6. VISUAL DEPTH AND BACKGROUND ART

Reproduce the reference's cinematic atmosphere without compromising usability.

- Allow a configurable landscape wallpaper in the sidebar or a designated decorative region.
- Use a dark gradient overlay over wallpaper.
- Keep text and icons readable regardless of the selected wallpaper.
- Do not place busy imagery behind the code editor or dense information tables.
- Keep wallpaper decoration secondary to the workspace.
- Support wallpaper blur and overlay intensity settings.
- Include a no-wallpaper option.
- Use subtle shadows only where they help separate layers.
- Avoid excessive glassmorphism, glow, blur or gradient effects.
- Use restrained copper highlights and subtle lighting rather than neon outlines.

If image assets already exist, reuse them where appropriate. If no suitable assets exist, create a clean fallback using gradients and local assets. Do not depend on external image URLs for the application's essential appearance.

## 7. TYPOGRAPHY AND ICONOGRAPHY

Use a consistent type scale and a modern UI font.

Preferred font strategy:
- Use an existing project font if it already fits.
- Otherwise prefer Inter or a similar neutral, high-quality UI sans-serif.
- Provide sensible system font fallbacks.
- Use a monospaced font such as JetBrains Mono for code and diffs when available.

Suggested typography:
- App brand: 16–18 px semibold.
- Project title: 21–25 px semibold.
- Section title: 14–16 px semibold.
- Body: 12–14 px at dense desktop layouts, with comfortable line-height.
- Secondary metadata: 11–12 px, but never so small that it becomes difficult to read.
- Code: approximately 12–13 px with a consistent line height.

Use one consistent icon set already installed in the project. If none exists, choose a single lightweight icon library compatible with the current stack.

Use consistent stroke weight and icon sizing.

Do not use emoji as replacements for core navigation or product icons.

## 8. APP CHROME AND TOP TOOLBAR

Implement a desktop application header that resembles the reference:

- Application brand/logo at the left sidebar header.
- Breadcrumb or current-project context near the top of the workspace.
- Global search field with a keyboard shortcut hint.
- Primary Run Agent button with an amber/copper treatment.
- Secondary actions for documentation/help, notifications, settings and window/fullscreen controls as appropriate.
- Compact controls with consistent hit areas.
- Tooltips for icon-only controls.
- Visible hover, focus, active and disabled states.

If the current desktop runtime supports native window controls or title-bar integration, preserve compatibility with it. Do not create fake draggable regions that interfere with buttons or text selection.

## 9. LEFT SIDEBAR

Recreate the following hierarchy:

Brand:
- Axiom Studio
- Subtitle: AI Engineering Studio

Project search:
- Search projects...
- Keyboard shortcut hint

Primary navigation:
- Home
- Projects
- Initiatives
- Tasks
- AI Agents
- Knowledge
- Decisions
- Tests
- Deploy

Workspace section:
- Current workspace selector
- Expandable project tree
- Example folders: src, auth, components, types, docs, tests
- Example files: auth.service.ts, auth.controller.ts, github-oauth.ts, login-view.tsx, auth.test.ts

Bottom section:
- External Services
- Model & Network
- Settings
- User/account area

Requirements:
- Clearly highlight the selected navigation item.
- Use a muted warm surface and subtle copper edge or highlight for selection.
- Keep icon and label alignment consistent.
- Support expanded/collapsed groups.
- Project tree indentation must be clear.
- Long names must truncate gracefully with tooltips where useful.
- Do not let decorative wallpaper reduce text readability.
- Use realistic placeholder project data only when real data is unavailable.

## 10. PROJECT HEADER AND TABS

At the top of the central workspace show:

- Project icon or thumbnail.
- Project name: ai-engineering-studio.
- Favorite/star action.
- Short project description: Local-first • Multi-agent • Decision-driven development.
- Git branch selector with example branch main.
- Sync status indicator.
- Open in Editor action.
- Overflow menu.

Under the project header, provide tabs:
- Chat
- Plan
- Tasks
- Files
- Tests
- Decisions
- Logs

The active tab should use a subtle copper underline and restrained surface highlight.

The tabs must be real interactive navigation elements within the application's existing routing/state model, not merely decorative labels.

Preserve the active tab visually and semantically.

If a route or feature is not yet implemented, provide an intentional placeholder view instead of a dead control.

## 11. CENTRAL CHAT AND EXECUTION PLAN

The central conversation is the most important region.

User message example:
"Implement authentication for the desktop app."

Associated requirements:
- Use the approved architecture in ADR-001.
- Add email/password and GitHub OAuth.
- Include unit tests and update documentation.

Show compact context chips for associated artifacts where appropriate:
- ADR-001
- auth-spec.md
- desktop-app

The assistant response should introduce the execution plan in a readable way.

Create an Execution Plan card with:
- A section heading and icon.
- Completion summary, e.g. 4/5 completed.
- A restrained progress bar.
- Numbered execution steps.
- Status indicators.
- Step descriptions.
- Optional duration or status metadata.

Example steps:
1. Design & Plan — Review ADR-001 and define implementation tasks.
2. Implement — Add authentication UI, backend logic and integrations.
3. Review — Run code review and fix issues.
4. Test — Run unit and integration tests.
5. Documentation — Update docs and usage guide.

Status visuals:
- Completed: muted green check.
- In progress: copper/amber indicator.
- Pending: subdued neutral indicator.
- Failed: semantic error indicator with explanatory details.

Do not imply that a task, test or agent has actually completed unless the underlying data confirms it. Example statuses are demo data only.

Provide functional controls where appropriate:
- View Plan
- Edit Plan
- Create Tasks
- Review
- Test
- Documentation
- Additional actions menu

Avoid overly large chat bubbles. Use compact, readable surfaces and consistent vertical spacing.

## 12. LOWER CODE REVIEW / DIFF WORKSPACE

The bottom part of the central workspace contains a code review region.

Suggested layout:
- Left file explorer/diff file list: approximately 240–270 px.
- Right code editor/diff viewer: remaining width.
- Resizable split between file list and code.
- Tabs for Changes, Tests, Logs and Preview.
- File count badge.
- Test summary badge where real test data exists.
- Split/Unified diff toggle.
- Copy or other editor actions.

Example file tree:
- src/auth/auth.service.ts
- src/auth/auth.controller.ts
- src/auth/github-oauth.ts
- src/auth/login-view.tsx
- src/auth/auth.test.ts
- docs/authentication.md
- tests/auth.integration.test.ts

Use realistic file change markers:
- M for modified
- A for added
- D for deleted, if applicable

Diff viewer:
- Monospaced text.
- Line numbers.
- Clear but restrained inserted/deleted line backgrounds.
- Syntax highlighting.
- Minimal visual noise.
- Readable contrast.
- Horizontal overflow handled inside the editor rather than across the whole application.
- Preserve indentation and line alignment.

If the repository already has a real code editor or diff library, use it where practical.

Do not install a heavy editor dependency without first checking whether the existing stack already provides one.

If this is a visual prototype without real diff integration, create a lightweight, realistic diff component and make the prototype status explicit.

## 13. RIGHT-SIDE CONTEXT PANEL

Implement the following cards in the same order as the reference.

### A. Project Overview
- Small landscape/banner image.
- Project title and Edit action.
- Brief project description.
- Technology tags, e.g. Desktop App, TypeScript, Tauri, React.
- Project status chips: Local-first, In Progress, Private.

### B. Current Initiative
- Initiative identifier: AUTH.
- Initiative title and short description.
- Status label.
- Progress bar and percentage.

### C. Tasks
- Section title and task count.
- Add action.
- Compact task rows.
- Completion checkboxes.
- Task title.
- Assigned agent/avatar.
- Optional duration or status metadata.

### D. AI Agents
- Section title.
- Active-agent count when available.
- Manage action.
- Agent rows for Developer Agent, Reviewer Agent and Test Agent.
- Avatar/icon.
- Status dot.
- Current activity.
- Overflow menu.

### E. Context
- Current task ID.
- Git branch.
- Selected model.
- Network policy.
- Workspace mode.
- Edit action.

Requirements:
- Cards must share a consistent visual system.
- Use compact spacing but preserve readability.
- Long text should wrap or truncate intelligently.
- Use semantic status indicators.
- The panel must scroll independently when necessary.
- Do not force every card to remain fully visible at the expense of the main workspace.
- Support collapsing individual sections if the current architecture makes this practical.

## 14. BOTTOM PROMPT COMPOSER

Anchor a composer to the bottom of the central workspace.

Include:
- Attachment button.
- Placeholder: "Ask Axiom Studio anything..."
- Context/action shortcuts: Plan, Code, Review, Test, Docs, Web and More.
- Model selector.
- Send/Run button.

Visual design:
- Slightly elevated surface.
- Subtle border.
- Rounded corners.
- Restrained copper send button.
- Clear hover, focus and disabled states.
- Composer must remain visually distinct from the code editor without overpowering it.

Behavior:
- Text entry must work.
- Enter should submit only if consistent with the product's intended keyboard behavior.
- Shift+Enter should insert a newline where multiline input is supported.
- Do not lose the draft when changing unrelated UI settings.
- Disable submission when empty if that matches the product behavior.
- Use existing AI request logic if implemented.
- If AI execution is not yet connected, implement a clear demo interaction without pretending a real model has run.

The model selector must display the actual selected model when backend/model configuration exists. Otherwise label the state as a prototype.

## 15. APPEARANCE CUSTOMIZATION PANEL

A major approved requirement is user customization.

Implement an Appearance panel opened from Settings or the toolbar. Match the floating settings panel in the reference.

The panel should support:

### Theme mode
- Dark
- Light
- Auto / follow system

Dark is the default.

### Color palette
Provide a small set of cohesive presets, for example:
- Espresso — warm charcoal and copper
- Graphite — neutral charcoal and cool gray
- Forest — muted dark green and sage
- Ocean — deep blue-gray and soft teal
- Plum — subdued aubergine and lavender-gray

All palettes must be tasteful, low-glare and professional. Avoid oversaturated neon palettes.

### Accent color
Provide curated accent options such as:
- Copper
- Blue
- Teal
- Green
- Violet
- Rose

Accent changes must update semantic UI tokens, selected states, buttons, focus rings and progress highlights consistently.

### UI density
- Compact
- Default
- Spacious

Density should adjust component height, gaps and padding consistently without breaking the layout.

### Font
- Default UI font
- Alternative supported UI font if available
- Monospaced code font options

Do not claim a font is available unless it is installed, bundled or otherwise reliably provided.

### Background
- None
- Aurora
- Mountains
- Forest
- Desert
- Ocean

Only use available local assets or assets that are added to the repository with appropriate licensing. Provide graceful fallbacks if assets are missing.

### Additional settings
- Wallpaper blur toggle.
- Reduce motion toggle.

Functional requirements:
- Changes must be reflected immediately.
- Settings must affect the actual application, not just the appearance panel.
- Theme, palette, accent, density and other preferences must persist across application restarts using the project's established persistence mechanism.
- Prefer a versioned, typed settings model.
- Handle missing or outdated saved preferences gracefully.
- Do not store API keys, secrets or sensitive credentials in UI preference storage.
- Provide a reset-to-default action.
- Respect system accessibility preferences where applicable.

Avoid duplicating the entire application for every theme. Use semantic design tokens.

## 16. INTERACTIONS AND STATES

Every visible interactive control must have a defined behavior.

At minimum, implement:
- Sidebar navigation and collapse.
- Project selection.
- Expandable project tree.
- Search field input and useful empty states.
- Project tabs.
- Appearance panel open/close.
- Theme/palette/accent selection.
- Density selection.
- Wallpaper selection and blur.
- Reduce motion.
- Task completion toggles in demo/local state.
- Expand/collapse context panel.
- Expand/collapse relevant cards.
- Composer text input.
- Model selector UI.
- Dropdown menus.
- Tooltips for icon-only controls.
- Keyboard focus and visible focus indicators.

Use existing app navigation, state management and persistence where available.

Do not implement fake backend operations or report false success for actions that have not actually happened.

If a feature depends on an unavailable backend, make the unavailable/demo state explicit.

## 17. ACCESSIBILITY AND USABILITY

- Maintain readable contrast for all text.
- Never rely on color alone to communicate status.
- Provide labels for icon-only controls.
- Support keyboard navigation and visible focus states.
- Respect reduced-motion preferences.
- Use adequate hit targets for frequently used controls.
- Avoid unnecessary animation, parallax or constant movement.
- Ensure code and diff text remain legible for extended sessions.
- Use tooltips and accessible names appropriately.
- Avoid overly small text and low-contrast secondary labels.

The UI should feel calm during long engineering sessions.

## 18. RESPONSIVE BEHAVIOR

This is a desktop-first application, not a mobile-first website.

At wide desktop sizes:
- Show sidebar, central workspace and right context panel.

At medium widths:
- Collapse the sidebar or reduce it to an icon rail.
- Allow the right context panel to collapse.
- Preserve the central workspace as the primary region.

At narrower windows:
- Prioritize chat, execution plan, code and diff.
- Move secondary project context into a collapsible panel or drawer.
- Avoid clipping the composer or hiding important controls.
- Avoid horizontal scrolling across the entire application.

Support sensible minimum window dimensions compatible with the existing desktop shell.

## 19. IMPLEMENTATION QUALITY

- Use reusable components and a consistent token system.
- Keep component responsibilities focused.
- Prefer CSS Grid and Flexbox for layout.
- Avoid giant monolithic components.
- Avoid hardcoded absolute coordinates for primary layout.
- Avoid duplicated styles and arbitrary one-off colors.
- Use TypeScript types where the project uses TypeScript.
- Preserve existing application architecture and integrations.
- Reuse installed dependencies before adding new ones.
- Avoid unnecessary packages.
- Do not refactor unrelated modules.
- Do not modify business logic or security policies just to produce a visual mockup.
- Keep sample data isolated from production data sources.
- Preserve local-first product behavior.

If the existing app already implements some of these sections, extend them rather than creating duplicate screens.

## 20. VISUAL VERIFICATION — REQUIRED

Do not stop when the page compiles.

After implementation:

1. Run the project's existing lint, type-check and build scripts where available.
2. Launch the application using its existing supported workflow.
3. Capture a screenshot at approximately 1536 × 1024 px.
4. Compare the screenshot directly against the supplied reference.
5. Inspect:
   - Sidebar width and hierarchy
   - Main/context panel proportions
   - Header height
   - Vertical spacing
   - Card density
   - Composer placement
   - Code/diff visibility
   - Colors and contrast
   - Typography
   - Overflow and clipping
6. Correct obvious mismatches.
7. Capture another screenshot after refinement.
8. Test appearance customization and ensure changes affect the actual UI.
9. Test a narrower desktop viewport and verify panel collapsing.

If screenshot capture or visual testing is unavailable in the current environment, state that limitation honestly and provide the exact remaining verification steps.

Do not claim pixel-perfect parity without checking screenshots.

## 21. SCOPE CONTROL

Implement the UI in manageable steps:

Phase 1:
- Design tokens and theme infrastructure.
- Main desktop shell.
- Sidebar, toolbar and project header.
- Central workspace layout.
- Right context panel.

Phase 2:
- Chat and execution plan.
- File tree and diff area.
- Prompt composer.
- Shared cards and status components.

Phase 3:
- Appearance panel.
- Theme/palette/accent/density customization.
- Preference persistence.
- Collapsible panels and responsive behavior.

Phase 4:
- Visual refinement against the reference screenshot.
- Accessibility checks.
- Existing tests, type checks and build verification.

Do not stop after creating only a static screenshot or a decorative prototype if the existing project supports real UI implementation.

Do not expand scope into unrelated backend, model-routing or agent-orchestration work.

## 22. COMPLETION REPORT

When finished, report:
- Files created or changed.
- Components implemented.
- Interactions that genuinely work.
- Appearance preferences that persist.
- Existing functionality preserved.
- Tests, type checks and build results.
- Screenshot verification status.
- Known limitations or features still mocked.

Start by inspecting the repository, then implement the interface. Do not merely return another design proposal.