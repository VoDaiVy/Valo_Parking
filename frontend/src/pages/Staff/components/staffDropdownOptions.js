export const normalizeDropdownOptions = (options = []) => (
  (Array.isArray(options) ? options : []).map((option) => {
    if (Array.isArray(option)) {
      return {
        value: option[0],
        label: option[1],
        disabled: false,
      };
    }

    return {
      value: option.value,
      label: option.label,
      disabled: Boolean(option.disabled),
    };
  })
);

export const getSelectedDropdownOption = (options, value) => (
  options.find((option) => option.value === value) || options[0] || null
);
