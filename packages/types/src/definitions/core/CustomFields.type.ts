export type CustomFieldKey = string;

/**
 * - text: each event holds a text value
 * - image: each event holds an image url
 * - cue: the field is a lane of timeline cues, each cue with its own name
 */
export type CustomField = {
  type: 'text' | 'image' | 'cue';
  colour: string;
  label: string;
};

export type CustomFields = Record<CustomFieldKey, CustomField>;
export type EntryCustomFields = Record<CustomFieldKey, string>;
