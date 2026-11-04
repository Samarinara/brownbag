'use client';

import * as React from 'react';
import { cn } from '../lib/utils';
import { FieldContext, useFieldControl } from '../lib/field-context';

const inputClass = 'w-full min-w-0 rounded-none border-0 border-b border-border bg-transparent px-0 py-3 text-xl leading-normal text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

export const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(
  ({ className, ...props }, ref) => <input data-polli="input" ref={ref} className={cn(inputClass, className)} {...useFieldControl(props)} />,
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'>>(
  ({ className, ...props }, ref) => <textarea data-polli="textarea" ref={ref} className={cn(inputClass, 'min-h-28 resize-y', className)} {...useFieldControl(props)} />,
);
Textarea.displayName = 'Textarea';

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentPropsWithoutRef<'select'>>(
  ({ className, ...props }, ref) => <select data-polli="select" ref={ref} className={cn(inputClass, className)} {...useFieldControl(props)} />,
);
NativeSelect.displayName = 'NativeSelect';

export const Label = React.forwardRef<HTMLLabelElement, React.ComponentPropsWithoutRef<'label'>>(
  ({ className, htmlFor, ...props }, ref) => {
    const field = React.useContext(FieldContext);
    return <label data-polli="label" ref={ref} htmlFor={htmlFor ?? field?.id} className={cn('block text-sm font-medium', className)} {...props} />;
  },
);
Label.displayName = 'Label';

export type FieldProps = React.ComponentPropsWithoutRef<'div'> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Control ID for a custom control or an explicitly named nested control. */
  htmlFor?: string;
};

export const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ label, hint, error, htmlFor, children, className, ...props }, ref) => {
    const generatedId = React.useId();
    const labelElement = React.isValidElement<{ htmlFor?: string }>(label) && (label.type === Label || label.type === 'label') ? label : undefined;
    const control = React.Children.toArray(children).find(child => React.isValidElement<{ id?: string }>(child) && child.props.id);
    const id = htmlFor ?? labelElement?.props.htmlFor ?? (React.isValidElement<{ id?: string }>(control) ? control.props.id : undefined) ?? generatedId;
    const invalid = error !== undefined && error !== null && error !== false && error !== '';
    const message = invalid ? error : hint;
    const hasMessage = message !== undefined && message !== null && message !== false && message !== '';
    const messageId = `${generatedId}-message`;
    const descriptionId = hasMessage ? (React.isValidElement<{ id?: string }>(message) ? message.props.id : undefined) ?? messageId : undefined;
    return <FieldContext.Provider value={{ id, descriptionId, invalid }}>
      <div data-polli="field" ref={ref} className={cn('min-w-0 space-y-2', className)} {...props}>
        {labelElement ? React.cloneElement(labelElement, { htmlFor: id }) : <Label htmlFor={id}>{label}</Label>}
        {children}
        {hasMessage ? <p id={messageId} role={invalid ? 'alert' : undefined} className={invalid ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{message}</p> : null}
      </div>
    </FieldContext.Provider>;
  },
);
Field.displayName = 'Field';
