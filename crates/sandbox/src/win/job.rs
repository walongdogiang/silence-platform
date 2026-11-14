//! Job objects: kill the whole tree on close, cap memory and process count.

use crate::spec::Limits;
use anyhow::{Context, Result};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
    JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct Job(pub HANDLE);

unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    pub fn new(limits: &Limits) -> Result<Self> {
        unsafe {
            let job = Job(CreateJobObjectW(None, None).context("CreateJobObjectW")?);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            let mut flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if let Some(mb) = limits.memory_mb {
                flags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
                info.JobMemoryLimit = (mb as usize).saturating_mul(1024 * 1024);
            }
            if let Some(n) = limits.max_processes {
                flags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
                info.BasicLimitInformation.ActiveProcessLimit = n;
            }
            info.BasicLimitInformation.LimitFlags = flags;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .context("SetInformationJobObject")?;
            Ok(job)
        }
    }

    pub fn assign(&self, process: HANDLE) -> Result<()> {
        unsafe { AssignProcessToJobObject(self.0, process).context("AssignProcessToJobObject") }
    }

    pub fn terminate(&self, code: u32) {
        unsafe {
            let _ = TerminateJobObject(self.0, code);
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
