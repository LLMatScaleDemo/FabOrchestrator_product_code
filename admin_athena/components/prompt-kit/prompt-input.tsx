import * as React from "react"
import { cn } from "@/lib/utils"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    TooltipProvider
} from "@/components/ui/tooltip"

interface PromptInputProps extends React.HTMLAttributes<HTMLDivElement> {
    isLoading?: boolean
    value?: string
    onValueChange?: (value: string) => void
    onSubmit?: () => void
}

const PromptInputContext = React.createContext<PromptInputProps | null>(null)

const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
    ({ className, isLoading, value, onValueChange, onSubmit, children, ...props }, ref) => {
        return (
            <PromptInputContext.Provider value={{ isLoading, value, onValueChange, onSubmit }}>
                <div ref={ref} className={cn("", className)} {...props}>
                    {children}
                </div>
            </PromptInputContext.Provider>
        )
    }
)
PromptInput.displayName = "PromptInput"

const PromptInputTextarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
    const context = React.useContext(PromptInputContext)
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        context?.onValueChange?.(e.target.value)
        props.onChange?.(e)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            context?.onSubmit?.()
        }
        props.onKeyDown?.(e)
    }

    return (
        <textarea
            ref={ref}
            value={context?.value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className={cn(
                "flex min-h-[60px] w-full rounded-md bg-transparent border-0 focus-visible:ring-0 focus:outline-none resize-none px-3 py-2 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
                className
            )}
            {...props}
        />
    )
})
PromptInputTextarea.displayName = "PromptInputTextarea"

const PromptInputActions = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center", className)} {...props} />
))
PromptInputActions.displayName = "PromptInputActions"

const PromptInputAction = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { tooltip?: string }
>(({ className, tooltip, children, ...props }, ref) => {
    if (tooltip) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div ref={ref} className={cn("", className)} {...props}>
                            {children}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>{tooltip}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )
    }
    return (
        <div ref={ref} className={cn("", className)} {...props} >{children}</div>
    )
})
PromptInputAction.displayName = "PromptInputAction"

export { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction }
