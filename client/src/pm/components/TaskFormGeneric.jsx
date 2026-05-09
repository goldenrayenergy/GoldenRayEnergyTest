import SmartFieldList from './SmartFieldList';

// Schema-driven controlled form. Delegates to SmartFieldList which groups
// fields into "Needed now / Already filled / Coming up / Optional" so the
// user only sees what matters at the current state.

export default function TaskFormGeneric({ schema, values = {}, currentState, missingFields, upstreamSuggestions, onChange }) {
  return (
    <SmartFieldList
      schema={schema}
      values={values}
      currentState={currentState}
      missingFields={missingFields || []}
      upstreamSuggestions={upstreamSuggestions || {}}
      onChange={onChange}
    />
  );
}
