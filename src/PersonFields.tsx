import { useState } from "react";

export default function PersonFields() {
  const [placeholder, setPlaceholder] = useState(false);
  return (
    <>
      <label>
        Person type
        <select value={placeholder ? "placeholder" : "account"}
          onChange={(event) => setPlaceholder(event.target.value === "placeholder")}>
          <option value="account">Existing account</option>
          <option value="placeholder">Placeholder</option>
        </select>
      </label>
      {placeholder ? (
        <label>
          Name
          <input name="displayName" required maxLength={100} placeholder="e.g. Jamie Chen" />
        </label>
      ) : (
        <label>
          Username or email
          <input name="identifier" required maxLength={254}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="johndoe123 or johndoe@example.com" />
        </label>
      )}
      <small>{placeholder
        ? "Create a person without an account to track their share."
        : "Link their existing account so they can see shared receipts. No invitation email is sent."}</small>
    </>
  );
}
