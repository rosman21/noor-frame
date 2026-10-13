# Expose only MMC device 1 (the frame's 15.8 GB eMMC) as a read-only USB disk.
# The U-Boot patch reports write protection and refuses UMS writes.
ums 0 mmc 1
