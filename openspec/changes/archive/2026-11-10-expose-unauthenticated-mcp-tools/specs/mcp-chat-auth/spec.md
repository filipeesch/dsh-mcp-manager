# Spec Delta

## REMOVED Requirements

### Requirement: Localized copy

**Reason**: The plugin's interface is English-only now, defined by the `plugin-language` capability. Keeping a per-surface bilingual requirement would contradict it.

**Migration**: No action needed. Every string the banner renders is already present in English and stays unchanged in behavior; only the second-language obligation is dropped.
