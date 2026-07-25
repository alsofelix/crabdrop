import {getModalKeyboardAction} from "./ui_logic.ts";

interface ModalVisibility {
    classList: {
        contains(name: string): boolean;
    };
}

export function getTopmostVisibleModal<T extends ModalVisibility>(
    modals: ArrayLike<T>,
): T | null {
    for (let index = modals.length - 1; index >= 0; index--) {
        const modal = modals[index];
        if (!modal.classList.contains("hidden")) {
            return modal;
        }
    }
    return null;
}

export function setupModalKeyboardControls(rootDocument: Document = document): void {
    const modals = rootDocument.querySelectorAll<HTMLElement>(
        ".modal[data-modal-primary][data-modal-cancel]",
    );
    let lastFocusedOutsideModal = rootDocument.activeElement instanceof HTMLElement
        ? rootDocument.activeElement
        : null;

    rootDocument.addEventListener("focusin", event => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target && !target.closest(".modal")) {
            lastFocusedOutsideModal = target;
        }
    });

    rootDocument.addEventListener("keydown", event => {
        const modal = getTopmostVisibleModal(modals);
        if (!modal) {
            return;
        }

        if (event.repeat && (event.key === "Enter" || event.key === "Escape")) {
            event.preventDefault();
            return;
        }

        const target = event.target instanceof HTMLElement ? event.target : null;
        const action = getModalKeyboardAction({
            key: event.key,
            modalVisible: true,
            targetTag: target?.tagName,
            targetIsContentEditable: target?.isContentEditable,
            targetIsModalButton: target instanceof HTMLButtonElement
                && target.closest(".modal") === modal,
            repeat: event.repeat,
            isComposing: event.isComposing,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
        });
        if (action === null) {
            return;
        }

        const buttonId = action === "primary"
            ? modal.dataset.modalPrimary
            : action === "cancel"
                ? modal.dataset.modalCancel
                : null;
        const button = action === "target-button"
            ? target as HTMLButtonElement
            : buttonId
                ? rootDocument.getElementById(buttonId) as HTMLButtonElement | null
                : null;
        if (!button || button.disabled) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        const returnFocusTarget = lastFocusedOutsideModal;
        const restoresFocus = action === "cancel"
            || button.id === modal.dataset.modalCancel;
        button.click();

        if (restoresFocus) {
            queueMicrotask(() => {
                if (!modal.classList.contains("hidden")) {
                    return;
                }

                const canRestorePreviousFocus = returnFocusTarget?.isConnected
                    && !returnFocusTarget.closest(".hidden")
                    && !returnFocusTarget.matches(":disabled");
                const browserScreen = rootDocument.getElementById("browser-screen");
                const fallback = browserScreen?.classList.contains("hidden")
                    ? null
                    : rootDocument.getElementById("file-list");
                (canRestorePreviousFocus ? returnFocusTarget : fallback)?.focus();
            });
        }
    });
}
