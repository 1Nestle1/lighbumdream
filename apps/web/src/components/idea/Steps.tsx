import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLineUpIcon,
  CaretDownIcon,
  CheckIcon,
  FootprintsIcon,
  PencilSimpleIcon,
  PlusIcon,
  SealCheckIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { IdeaStep } from "@lightbulb/shared";
import { LIMITS } from "@lightbulb/shared/constants";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/format";
import type { useNotebookActions } from "../../lib/queries";
import { useToast } from "../Toaster";
import { Button, IconButton, inputClass } from "../ui";

type Actions = ReturnType<typeof useNotebookActions>;

/** One-line input that adds a step. Used in the next-step card and under the checklist. */
function AddStepForm({
  actions,
  count,
  autoFocus = false,
  className,
}: {
  actions: Actions;
  count: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const { m, fmt, errorText } = useI18n();
  const toast = useToast();
  const [text, setText] = useState("");
  const full = count >= LIMITS.steps;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || full) return;
    actions.addStep.mutate(value, {
      onSuccess: () => setText(""),
      onError: (err) => toast({ tone: "error", message: errorText(err) }),
    });
  };

  if (full) return <p className={cn("text-[13px] text-ink-soft", className)}>{fmt(m.ideaPage.stepsFull, { max: LIMITS.steps })}</p>;

  return (
    <form onSubmit={submit} className={cn("flex items-center gap-2", className)}>
      <label className="sr-only" htmlFor={autoFocus ? "first-step" : "new-step"}>
        {m.ideaPage.stepLabel}
      </label>
      <div className="relative flex-1">
        <PlusIcon
          size={15}
          weight="bold"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
        <input
          id={autoFocus ? "first-step" : "new-step"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={LIMITS.stepChars}
          placeholder={m.ideaPage.stepPlaceholder}
          autoComplete="off"
          autoFocus={autoFocus}
          className={cn(inputClass, "pl-9")}
        />
      </div>
      <Button type="submit" size="md" disabled={!text.trim() || actions.addStep.isPending}>
        {m.ideaPage.addStep}
      </Button>
    </form>
  );
}

/**
 * The centre of the page: one clear next action and a Done button. Completing it
 * brings the next step up, which is the whole point of the product.
 */
export function NextStepCard({ steps, actions }: { steps: IdeaStep[]; actions: Actions }) {
  const { m, fmt, errorText } = useI18n();
  const toast = useToast();
  const open = steps.filter((s) => !s.done);
  const done = steps.length - open.length;
  const next = open[0];

  const complete = () =>
    next &&
    actions.updateStep.mutate(
      { id: next.id, done: true },
      { onError: (err) => toast({ tone: "error", message: errorText(err) }) },
    );

  return (
    <section
      aria-labelledby="next-step-heading"
      className="relative overflow-hidden rounded-card border border-accent-ink/30 bg-panel p-5 shadow-card md:p-7"
    >
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-accent/25 blur-3xl" />

      <div className="relative flex items-center justify-between gap-3">
        <h2 id="next-step-heading" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <FootprintsIcon size={17} weight="bold" className="text-accent-ink" aria-hidden />
          {m.ideaPage.nextStep}
        </h2>
        {steps.length > 0 && (
          <span className="font-mono text-xs text-ink-faint">
            {fmt(m.ideaPage.progress, { done, total: steps.length })}
          </span>
        )}
      </div>

      {/* One segment per step: how far along the checklist this idea is. */}
      {steps.length > 1 && (
        <div className="relative mt-4 flex gap-1" aria-hidden>
          {steps.map((s) => (
            <span
              key={s.id}
              className={cn("h-1.5 flex-1 rounded-full transition-colors duration-500", s.done ? "bg-accent" : "bg-line")}
            />
          ))}
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {next ? (
          <motion.div
            key={next.id}
            className="relative"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
          >
            <p className="mt-5 text-2xl font-semibold leading-snug tracking-tight text-ink md:text-[1.75rem]">{next.text}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={complete} disabled={actions.updateStep.isPending}>
                <CheckIcon size={17} weight="bold" aria-hidden /> {m.ideaPage.done}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={steps.length ? "all-done" : "empty"}
            className="relative mt-5"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {steps.length > 0 ? (
              <>
                <p className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                  <SealCheckIcon size={24} weight="fill" className="text-accent-ink" aria-hidden />
                  {m.ideaPage.allDoneTitle}
                </p>
                <p className="mt-1.5 text-sm text-ink-soft">{m.ideaPage.allDoneBody}</p>
              </>
            ) : (
              <p className="text-xl font-semibold leading-snug tracking-tight">{m.ideaPage.noStepsTitle}</p>
            )}
            <AddStepForm actions={actions} count={steps.length} autoFocus={steps.length === 0} className="mt-5" />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function StepRow({ step, isNext, actions }: { step: IdeaStep; isNext: boolean; actions: Actions }) {
  const { m, errorText } = useI18n();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.text);
  const onError = (err: Error) => toast({ tone: "error", message: errorText(err) });

  const saveEdit = () => {
    const value = draft.trim();
    setEditing(false);
    if (value && value !== step.text) actions.updateStep.mutate({ id: step.id, text: value }, { onError });
    else setDraft(step.text);
  };

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
      className="group flex items-start gap-3 rounded-field px-2.5 py-2 transition-colors hover:bg-sunken/70"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={step.done}
        aria-label={step.done ? m.ideaPage.undoStep : m.ideaPage.completeStep}
        onClick={() => actions.updateStep.mutate({ id: step.id, done: !step.done }, { onError })}
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors active:scale-90",
          step.done
            ? "border-accent bg-accent text-on-accent"
            : "border-line-strong text-transparent hover:border-accent-ink hover:text-accent-ink",
        )}
      >
        <CheckIcon size={11} weight="bold" aria-hidden />
      </button>

      {editing ? (
        <input
          value={draft}
          autoFocus
          maxLength={LIMITS.stepChars}
          aria-label={m.ideaPage.editStep}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(step.text);
              setEditing(false);
            }
          }}
          className="-my-1 min-w-0 flex-1 rounded-[10px] bg-panel px-2 py-1 text-[15px] text-ink outline-none ring-2 ring-accent/40"
        />
      ) : (
        <span
          className={cn(
            "min-w-0 flex-1 text-[15px] leading-snug",
            step.done ? "text-ink-faint line-through decoration-ink-faint/60" : "text-ink",
          )}
        >
          {step.text}
          {isNext && (
            <span className="ml-2 inline-flex translate-y-[-1px] rounded-full bg-accent-soft px-2 py-0.5 align-middle text-[11px] font-semibold text-accent-ink">
              {m.ideaPage.nextBadge}
            </span>
          )}
        </span>
      )}

      {!editing && (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!step.done && !isNext && (
            <IconButton label={m.ideaPage.makeNext} size="sm" className="!h-7 !w-7" onClick={() => actions.makeStepNext.mutate(step.id, { onError })}>
              <ArrowLineUpIcon size={15} />
            </IconButton>
          )}
          {!step.done && (
            <IconButton label={m.ideaPage.editStep} size="sm" className="!h-7 !w-7" onClick={() => setEditing(true)}>
              <PencilSimpleIcon size={15} />
            </IconButton>
          )}
          <IconButton label={m.ideaPage.deleteStep} size="sm" className="!h-7 !w-7" onClick={() => actions.deleteStep.mutate(step.id, { onError })}>
            <XIcon size={15} />
          </IconButton>
        </span>
      )}
    </motion.li>
  );
}

/** The full checklist. Finished steps fold away so the open ones stay in focus. */
export function StepsSection({ steps, actions }: { steps: IdeaStep[]; actions: Actions }) {
  const { m, plural } = useI18n();
  const [showDone, setShowDone] = useState(false);
  const open = steps.filter((s) => !s.done);
  const done = steps.filter((s) => s.done);
  if (steps.length === 0) return null;

  return (
    <section aria-labelledby="steps-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="steps-heading" className="text-lg font-semibold tracking-tight">
          {m.ideaPage.stepsTitle}
        </h2>
        <span className="font-mono text-xs text-ink-faint">
          {steps.length}/{LIMITS.steps}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {open.map((step, i) => (
            <StepRow key={step.id} step={step} isNext={i === 0} actions={actions} />
          ))}
        </AnimatePresence>
      </ul>
      <AddStepForm actions={actions} count={steps.length} className="mt-3" />

      {done.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium text-ink-soft transition hover:bg-sunken hover:text-ink"
          >
            <CaretDownIcon size={13} weight="bold" className={cn("transition-transform", showDone && "rotate-180")} aria-hidden />
            {plural(m.ideaPage.doneSteps, done.length)}
          </button>
          <AnimatePresence initial={false}>
            {showDone && (
              <motion.ul
                className="mt-1 flex flex-col gap-0.5"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                {done.map((step) => (
                  <StepRow key={step.id} step={step} isNext={false} actions={actions} />
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
