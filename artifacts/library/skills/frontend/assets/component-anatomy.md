# Component anatomy template

Copy this file once per component and fill every section. Keep each
spec short and dense: the implementer needs the contract, not a novella.

```text
# <Component name>

## Purpose

One sentence: what user need does this component serve?

## Parts

- root
- icon (optional)
- label
- trailing-affordance (optional)

## States

- default
- hover
- focus-visible
- active / pressed
- disabled
- loading
- error (when applicable)

## Variants

- primary
- secondary
- ghost
- destructive

## Sizes

- sm
- md (default)
- lg

## Tokens consumed

- --color-accent (background, primary variant)
- --color-on-accent (text, primary variant)
- --space-md (padding-inline, md size)
- --radius-md
- --text-base

## Accessibility notes

- Semantic element: <button type="button">
- Accessible name: visible label, or aria-label for icon-only.
- Focus indicator: 2 px outline using --color-accent at 3:1 contrast.
- Touch target: minimum 44×44 CSS px.
- Disabled state communicated via aria-disabled, not removal from tab order.

## Motion notes

- State transitions: 150 ms ease-out on color and background-color.
- Honour prefers-reduced-motion: disable non-essential transitions.
- No animation on focus indicator appearance.
```
