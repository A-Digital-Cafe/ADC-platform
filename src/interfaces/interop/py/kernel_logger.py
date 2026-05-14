"""
Logger que se conecta al kernel de Node.js mediante IPC.
Permite que los módulos Python registren logs con los mismos niveles que el kernel.
"""

import os
import sys
from typing import Optional


class KernelLogger:
    """
    Logger proxy que se conecta al kernel Node.js mediante IPC.
    Todos los logs se envían al kernel para ser procesados uniformemente.
    """

    # Niveles de log soportados
    LOG_LEVELS = {
        "debug": "DEBUG",
        "info": "INFO",
        "ok": "OK",
        "warn": "WARN",
        "error": "ERROR",
    }

    def __init__(self, module_name: str):
        self.module_name = module_name
        self.log_level = os.environ.get("ADC_LOG_LEVEL", "info").lower()

    def _format_message(self, level: str, message: str) -> str:
        """Formatea el mensaje con el módulo y nivel"""
        return f"[{level}] [{self.module_name}] {message}"

    def _write_log(self, level: str, message: str) -> None:
        """Escribe el log a stderr en un formato que el kernel pueda capturar"""
        # El formato es: [LEVEL] [module_name] mensaje
        # Para que el kernel Node.js lo capture y lo formattee correctamente
        formatted = self._format_message(level, message)
        print(formatted, file=sys.stderr)

    def debug(self, message: str) -> None:
        """Log de nivel DEBUG"""
        self._write_log(self.LOG_LEVELS["debug"], message)

    def info(self, message: str) -> None:
        """Log de nivel INFO"""
        self._write_log(self.LOG_LEVELS["info"], message)

    def ok(self, message: str) -> None:
        """Log de nivel OK (éxito)"""
        self._write_log(self.LOG_LEVELS["ok"], message)

    def warn(self, message: str) -> None:
        """Log de nivel WARN (advertencia)"""
        self._write_log(self.LOG_LEVELS["warn"], message)

    def warning(self, message: str) -> None:
        """Alias para warn()"""
        self.warn(message)

    def error(self, message: str) -> None:
        """Log de nivel ERROR"""
        self._write_log(self.LOG_LEVELS["error"], message)


def get_kernel_logger(module_name: Optional[str] = None) -> KernelLogger:
    """
    Factory para crear un logger conectado al kernel.

    Args:
        module_name: Nombre del módulo. Si no se proporciona, usa ADC_MODULE_NAME

    Returns:
        KernelLogger: Instancia del logger
    """
    name = module_name or os.environ.get("ADC_MODULE_NAME", "unknown")
    return KernelLogger(name)

